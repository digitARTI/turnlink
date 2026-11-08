// Package main contains an isolated test relay, not a production security boundary.
package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"
)

const pinnedImage = "sha256:e7145600e1f15f63c0e01ef7ff7da9b29f1467dd4c2dc8c78320762dae8ab690"
const destinationImage = "sha256:a0f870ea39441ed26ad0d6d2315a71b18a88a99fc48e33da63b1d2afac589bd4"
const hashScript = "const f=require('node:fs'),c=require('node:crypto');const h=p=>c.createHash('sha256').update(f.readFileSync(p)).digest('hex');console.log(JSON.stringify({bundle:h('/sealed/plugin.mjs'),guard:h('/sealed/guard.mjs')}))"
const maxBody = 65536
const maxHeader = 16384
const maxResponse = 8 * 1024 * 1024

var hex64 = regexp.MustCompile(`^[a-f0-9]{64}$`)
var scopePattern = regexp.MustCompile(`^[A-Za-z0-9:._/-]{1,256}$`)
var namePattern = regexp.MustCompile(`^turnlink-plugin-test-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var sessionPattern = regexp.MustCompile(`^ses_[A-Za-z0-9_-]{1,128}$`)
var apiPrefix = regexp.MustCompile(`^/v[0-9]+\.[0-9]+(/.*)$`)
var denied = errors.New("fixture relay unavailable")

type config struct{ Scope, GrantScope, Image, Name, SessionID, Directory string }

func (c config) expectedScope() string {
	sum := sha256.Sum256([]byte("turnlink-vm-docker-scope-v1\x00" + c.GrantScope + "\x00" + c.Image + "\x00" + c.Name + "\x00" + c.SessionID + "\x00" + c.Directory))
	return hex.EncodeToString(sum[:])
}
func (c config) valid() bool {
	return hex64.MatchString(c.GrantScope) && scopePattern.MatchString(c.Scope) && c.Scope == c.expectedScope() && (c.Image == pinnedImage || c.Image == destinationImage) && namePattern.MatchString(c.Name) &&
		sessionPattern.MatchString(c.SessionID) && strings.HasPrefix(c.Directory, "/") && len(c.Directory) <= 2048 &&
		path.Clean(c.Directory) == c.Directory && !strings.ContainsAny(c.Directory, "\x00\r\n")
}

// A lease is deliberately single-use across relay restarts. This local fixture
// journal is a replay fence, not authentication or same-UID isolation.
func claimLease(directory string, c config) error {
	if !c.valid() {
		return denied
	}
	err := os.Mkdir(directory, 0700)
	created := err == nil
	if err != nil && !os.IsExist(err) {
		return denied
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return denied
	}
	if created {
		parent, err := os.Open(path.Dir(directory))
		if err != nil {
			return denied
		}
		err = parent.Sync()
		parent.Close()
		if err != nil {
			return denied
		}
	}
	f, err := os.OpenFile(path.Join(directory, c.Scope), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return denied
	}
	if _, err = f.WriteString("turnlink-docker-lease-v1\n"); err != nil {
		f.Close()
		return denied
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return denied
	}
	if err = f.Close(); err != nil {
		return denied
	}
	d, err := os.Open(directory)
	if err != nil {
		return denied
	}
	defer d.Close()
	if d.Sync() != nil {
		return denied
	}
	return nil
}
func (c config) command() []string {
	if c.Image == destinationImage {
		return []string{"-i", "PATH=/usr/local/bin:/usr/bin:/bin", "TURNLINK_DESTINATION_KEEP=1", "TURNLINK_DESTINATION_HOSTED=1",
			"TURNLINK_DESTINATION_SESSION=" + c.SessionID, "/usr/local/bin/turnlink-node", "/runner.mjs"}
	}
	return []string{"-i", "TURNLINK_STREAM_IPC=1", "NODE_NO_WARNINGS=1", "/usr/local/bin/turnlink-node", "--permission", "--allow-fs-read=/sealed", "--disallow-code-generation-from-strings", "--import", "/sealed/guard.mjs", "/sealed/plugin.mjs", "unused", c.SessionID, c.Directory}
}

// JSON decoder rejects duplicate keys at every nesting level, including keys
// which differ only by their escape spelling. Unknown fields are rejected by
// each call site's explicit whitelist.
func strictJSON(data []byte) (any, error) {
	if len(data) == 0 || len(data) > maxBody {
		return nil, denied
	}
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	var read func(int) (any, error)
	read = func(depth int) (any, error) {
		if depth > 20 {
			return nil, denied
		}
		tok, err := d.Token()
		if err != nil {
			return nil, denied
		}
		delim, ok := tok.(json.Delim)
		if !ok {
			return tok, nil
		}
		switch delim {
		case '{':
			obj := map[string]any{}
			for d.More() {
				key, e := d.Token()
				if e != nil {
					return nil, denied
				}
				k, ok := key.(string)
				if !ok {
					return nil, denied
				}
				if _, exists := obj[k]; exists {
					return nil, denied
				}
				v, e := read(depth + 1)
				if e != nil {
					return nil, e
				}
				obj[k] = v
			}
			end, e := d.Token()
			if e != nil || end != json.Delim('}') {
				return nil, denied
			}
			return obj, nil
		case '[':
			var values []any
			for d.More() {
				v, e := read(depth + 1)
				if e != nil {
					return nil, e
				}
				values = append(values, v)
			}
			end, e := d.Token()
			if e != nil || end != json.Delim(']') {
				return nil, denied
			}
			return values, nil
		default:
			return nil, denied
		}
	}
	value, err := read(0)
	if err != nil {
		return nil, err
	}
	if _, err = d.Token(); err != io.EOF {
		return nil, denied
	}
	return value, nil
}
func keys(obj map[string]any, allowed ...string) bool {
	set := map[string]bool{}
	for _, key := range allowed {
		set[key] = true
	}
	for key := range obj {
		if !set[key] {
			return false
		}
	}
	return true
}
func empty(v any) bool {
	if v == nil || v == false || v == "" {
		return true
	}
	switch x := v.(type) {
	case []any:
		return len(x) == 0
	case map[string]any:
		return len(x) == 0
	case json.Number:
		return x == "0"
	}
	return false
}
func array(v any, expected []string) bool {
	xs, ok := v.([]any)
	if !ok || len(xs) != len(expected) {
		return false
	}
	for i, x := range xs {
		if x != expected[i] {
			return false
		}
	}
	return true
}
func onlyEmpty(obj map[string]any, names ...string) bool {
	for _, name := range names {
		if !empty(obj[name]) {
			return false
		}
	}
	return true
}

func validateCreate(c config, body []byte) error {
	v, err := strictJSON(body)
	if err != nil {
		return denied
	}
	obj, ok := v.(map[string]any)
	if !ok || !keys(obj,
		"Hostname", "Domainname", "User", "AttachStdin", "AttachStdout", "AttachStderr", "Tty", "OpenStdin", "StdinOnce", "Env", "Cmd", "Image", "Volumes", "WorkingDir", "Entrypoint", "NetworkDisabled", "MacAddress", "OnBuild", "Labels", "StopSignal", "StopTimeout", "Shell", "ExposedPorts", "Healthcheck", "ArgsEscaped", "HostConfig", "NetworkingConfig") {
		return denied
	}
	if obj["Image"] != c.Image || obj["User"] != "10001:10001" || !array(obj["Entrypoint"], []string{"/usr/bin/env"}) || !array(obj["Cmd"], c.command()) || obj["OpenStdin"] != true || obj["AttachStdin"] != true || obj["AttachStdout"] != true || obj["AttachStderr"] != true || obj["StdinOnce"] != true || obj["Tty"] != false {
		return denied
	}
	if !onlyEmpty(obj, "Hostname", "Domainname", "Env", "Volumes", "WorkingDir", "NetworkDisabled", "MacAddress", "OnBuild", "StopSignal", "StopTimeout", "Shell", "ExposedPorts", "Healthcheck", "ArgsEscaped") {
		return denied
	}
	if obj["NetworkingConfig"] != nil {
		network, ok := obj["NetworkingConfig"].(map[string]any)
		if !ok || !keys(network, "EndpointsConfig") || !empty(network["EndpointsConfig"]) {
			return denied
		}
	}
	if !empty(obj["Labels"]) {
		return denied
	}
	host, ok := obj["HostConfig"].(map[string]any)
	if !ok || !keys(host,
		"Binds", "ContainerIDFile", "LogConfig", "NetworkMode", "PortBindings", "RestartPolicy", "AutoRemove", "VolumeDriver", "VolumesFrom", "ConsoleSize", "CapAdd", "CapDrop", "CgroupnsMode", "Dns", "DnsOptions", "DnsSearch", "ExtraHosts", "GroupAdd", "IpcMode", "Cgroup", "Links", "OomScoreAdj", "PidMode", "Privileged", "PublishAllPorts", "ReadonlyRootfs", "SecurityOpt", "UTSMode", "UsernsMode", "ShmSize", "Runtime", "Isolation", "CpuShares", "Memory", "NanoCpus", "CgroupParent", "BlkioWeight", "BlkioWeightDevice", "BlkioDeviceReadBps", "BlkioDeviceWriteBps", "BlkioDeviceReadIOps", "BlkioDeviceWriteIOps", "CpuPeriod", "CpuQuota", "CpuRealtimePeriod", "CpuRealtimeRuntime", "CpusetCpus", "CpusetMems", "Devices", "DeviceCgroupRules", "DeviceRequests", "MemoryReservation", "MemorySwap", "MemorySwappiness", "OomKillDisable", "PidsLimit", "Ulimits", "CpuCount", "CpuPercent", "IOMaximumIOps", "IOMaximumBandwidth", "MaskedPaths", "ReadonlyPaths", "Mounts", "Init", "Sysctls", "StorageOpt", "Tmpfs") {
		return denied
	}
	if host["NetworkMode"] != "none" || host["ReadonlyRootfs"] != true || !array(host["CapDrop"], []string{"ALL"}) || !array(host["SecurityOpt"], []string{"no-new-privileges"}) {
		return denied
	}
	if v := host["LogConfig"]; v != nil {
		log, ok := v.(map[string]any)
		if !ok || !keys(log, "Type", "Config") || !empty(log["Type"]) || !empty(log["Config"]) {
			return denied
		}
	}
	if v := host["RestartPolicy"]; v != nil {
		restart, ok := v.(map[string]any)
		if !ok || !keys(restart, "Name", "MaximumRetryCount") || restart["Name"] != "no" || !empty(restart["MaximumRetryCount"]) {
			return denied
		}
	}
	if v := host["ConsoleSize"]; v != nil {
		size, ok := v.([]any)
		if !ok || len(size) != 2 || size[0] != json.Number("0") || size[1] != json.Number("0") {
			return denied
		}
	}
	if c.Image == destinationImage {
		tmpfs, ok := host["Tmpfs"].(map[string]any)
		if !ok || len(tmpfs) != 2 || tmpfs["/state"] != "rw,nosuid,nodev,uid=10001,gid=10001,mode=0700" ||
			tmpfs["/tmp"] != "rw,nosuid,nodev,uid=10001,gid=10001,mode=0700" || host["PidsLimit"] != json.Number("64") {
			return denied
		}
	}
	for k, value := range host {
		switch k {
		case "NetworkMode", "ReadonlyRootfs", "CapDrop", "SecurityOpt", "AutoRemove", "LogConfig", "RestartPolicy", "ConsoleSize":
			continue
		case "MemorySwappiness":
			if value == json.Number("-1") {
				continue
			}
		case "Tmpfs", "PidsLimit":
			if c.Image == destinationImage {
				continue
			}
		}
		if !empty(value) {
			return denied
		}
	}
	if v := host["AutoRemove"]; v != nil && v != false && v != true {
		return denied
	}
	return nil
}

func validateExec(body []byte) error {
	v, err := strictJSON(body)
	if err != nil {
		return denied
	}
	obj, ok := v.(map[string]any)
	if !ok || !keys(obj, "AttachStdin", "AttachStdout", "AttachStderr", "DetachKeys", "Tty", "Env", "Cmd", "Privileged", "User", "WorkingDir") {
		return denied
	}
	if obj["User"] != "10001:10001" || !array(obj["Cmd"], []string{"/usr/local/bin/turnlink-node", "-e", hashScript}) || !onlyEmpty(obj, "Privileged", "Tty", "AttachStdin", "DetachKeys", "Env", "WorkingDir") || obj["AttachStdout"] != true || obj["AttachStderr"] != true {
		return denied
	}
	return nil
}

func mac(key []byte, domain, scope, challenge, nonce string) string {
	h := hmac.New(sha256.New, key)
	fmt.Fprintf(h, "%s\x00%s\x00%s\x00%s", domain, scope, challenge, nonce)
	return hex.EncodeToString(h.Sum(nil))
}
func auth(conn net.Conn, reader *bufio.Reader, c config, key []byte, domain, readyDomain string) error {
	if !c.valid() || len(key) != 32 {
		return denied
	}
	timer := time.AfterFunc(10*time.Second, func() { conn.Close() })
	defer timer.Stop()
	conn.SetDeadline(time.Now().Add(10 * time.Second))
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return denied
	}
	challenge := hex.EncodeToString(random[:])
	raw, _ := json.Marshal(map[string]any{"version": 1, "type": "challenge", "scope": c.Scope, "challenge": challenge})
	if len(raw)+1 > 512 {
		return denied
	}
	if _, err := conn.Write(append(raw, '\n')); err != nil {
		return denied
	}
	line, err := reader.ReadSlice('\n')
	if err != nil || len(line) > 512 {
		return denied
	}
	value, err := strictJSON(bytes.TrimSuffix(line, []byte{'\n'}))
	if err != nil {
		return denied
	}
	frame, ok := value.(map[string]any)
	if !ok || !keys(frame, "version", "type", "scope", "nonce", "tag") || frame["version"] != json.Number("1") || frame["type"] != "authenticate" || frame["scope"] != c.Scope {
		return denied
	}
	nonce, nok := frame["nonce"].(string)
	tag, tok := frame["tag"].(string)
	if !nok || !tok || !hex64.MatchString(nonce) || !hex64.MatchString(tag) {
		return denied
	}
	got, _ := hex.DecodeString(tag)
	expected, _ := hex.DecodeString(mac(key, domain, c.Scope, challenge, nonce))
	if !hmac.Equal(got, expected) {
		return denied
	}
	ready, _ := json.Marshal(map[string]any{"version": 1, "type": "ready", "scope": c.Scope, "tag": mac(key, readyDomain, c.Scope, challenge, nonce)})
	if len(ready)+1 > 512 {
		return denied
	}
	if _, err = conn.Write(append(ready, '\n')); err != nil {
		return denied
	}
	conn.SetDeadline(time.Time{})
	return nil
}

type relay struct {
	config          config
	key             []byte
	transport       http.RoundTripper
	ctx             context.Context
	cancel          context.CancelFunc
	mu              sync.Mutex
	closed          bool
	leaseClaimed    bool
	leaseActive     bool
	connections     map[net.Conn]struct{}
	container       string
	createAttempted bool
	execID          string
	execAttempted   bool
	execCount       int
	execTerminal    bool
	execSeen        map[string]bool
	dispatched      map[string]bool
}

func newRelay(c config, key []byte, transport http.RoundTripper) (*relay, error) {
	if !c.valid() || len(key) != 32 || transport == nil {
		return nil, denied
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &relay{config: c, key: append([]byte(nil), key...), transport: transport, ctx: ctx, cancel: cancel, connections: map[net.Conn]struct{}{}, dispatched: map[string]bool{}, execSeen: map[string]bool{}}, nil
}
func (s *relay) revoke() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.cancel()
	conns := make([]net.Conn, 0, len(s.connections))
	for conn := range s.connections {
		conns = append(conns, conn)
	}
	s.mu.Unlock()
	for _, conn := range conns {
		conn.Close()
	}
}

// A distinct authenticated control connection is held by the supervisor.
// Any byte, EOF, crash or timeout revokes the entire lease; the control stream
// does not support commands and cannot confer Docker dispatch authority.
func (s *relay) holdLease(conn net.Conn) error {
	s.mu.Lock()
	if s.closed || s.leaseClaimed {
		s.mu.Unlock()
		conn.Close()
		return denied
	}
	s.leaseClaimed = true
	s.connections[conn] = struct{}{}
	s.mu.Unlock()
	reader := bufio.NewReaderSize(conn, 4096)
	if auth(conn, reader, s.config, s.key, "turnlink-vm-docker-lease-v1", "turnlink-vm-docker-lease-ready-v1") != nil {
		conn.Close()
		s.revoke()
		return denied
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		conn.Close()
		return denied
	}
	s.leaseActive = true
	s.connections[conn] = struct{}{}
	s.mu.Unlock()
	go func() { reader.ReadByte(); s.revoke() }()
	return nil
}
func safeQuery(raw string, allowed map[string]map[string]bool) bool {
	values, err := url.ParseQuery(raw)
	if err != nil {
		return false
	}
	for key, value := range values {
		variants, ok := allowed[key]
		if !ok || len(value) != 1 || !variants[value[0]] {
			return false
		}
	}
	return true
}
func boolQuery(names ...string) map[string]map[string]bool {
	out := map[string]map[string]bool{}
	for _, name := range names {
		out[name] = map[string]bool{"0": true, "1": true, "false": true, "true": true}
	}
	return out
}
func cleanPath(r *http.Request) (string, bool) {
	if r.URL.IsAbs() || r.URL.Host != "" || r.URL.RawPath != "" || r.URL.Fragment != "" || strings.Contains(r.URL.Path, "//") || strings.ContainsAny(r.URL.Path, "\\\x00\r\n") {
		return "", false
	}
	path := r.URL.Path
	if m := apiPrefix.FindStringSubmatch(path); m != nil {
		path = m[1]
	}
	return path, true
}

// admit serializes decision and records single-use intents before dispatch.
// Closing a connection or revoking a lease after dispatch is uncertain, not a
// proof that the daemon did not perform the requested effect.
func (s *relay) admit(r *http.Request, body []byte) (string, error) {
	path, ok := cleanPath(r)
	if !ok {
		return "", denied
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || !s.leaseActive {
		return "", denied
	}
	method := r.Method
	q := r.URL.RawQuery
	if ((method == "HEAD" && path == "/_ping") || (method == "GET" && (path == "/_ping" || path == "/version" || path == "/info" || path == "/images/"+s.config.Image+"/json"))) && q == "" && len(body) == 0 {
		return "read", nil
	}
	if method == "POST" && path == "/containers/create" {
		if s.createAttempted || !safeQuery(q, map[string]map[string]bool{"name": {s.config.Name: true}}) || r.URL.Query().Get("name") != s.config.Name || validateCreate(s.config, body) != nil {
			return "", denied
		}
		s.createAttempted = true
		return "create", nil
	}
	if s.container == "" {
		return "", denied
	}
	if method == "GET" && path == "/turnlink-fixture/events" && q == "" && len(body) == 0 {
		return "fixture-events", nil
	}
	if method == "GET" && path == "/turnlink-fixture/exec-ticket" && q == "" && len(body) == 0 && s.execTerminal && s.execID != "" {
		return "exec-ticket", nil
	}
	if method == "POST" && path == "/turnlink-fixture/exec-ack" && q == "" && s.execTerminal && s.execID != "" {
		value, err := strictJSON(body)
		object, ok := value.(map[string]any)
		if err != nil || !ok || !keys(object, "id") || object["id"] != s.execID {
			return "", denied
		}
		s.execTerminal = false
		s.execAttempted = false
		s.execID = ""
		delete(s.dispatched, "exec-start")
		return "exec-ack", nil
	}
	base := "/containers/" + s.container
	switch {
	case method == "GET" && (path == base+"/json" || path == "/containers/"+s.config.Name+"/json") && q == "" && len(body) == 0:
		return "inspect", nil
	case method == "POST" && path == base+"/attach" && len(body) == 0 && safeQuery(q, boolQuery("stdin", "stdout", "stderr", "stream", "logs")):
		if s.dispatched["attach"] {
			return "", denied
		}
		s.dispatched["attach"] = true
		return "attach", nil
	case method == "POST" && path == base+"/start" && len(body) == 0 && q == "":
		if s.dispatched["start"] {
			return "", denied
		}
		s.dispatched["start"] = true
		return "start", nil
	case method == "POST" && path == base+"/wait" && len(body) == 0 && safeQuery(q, map[string]map[string]bool{"condition": {"not-running": true, "next-exit": true, "removed": true}}):
		return "wait", nil
	case method == "DELETE" && path == base && len(body) == 0 && safeQuery(q, boolQuery("force", "v", "link")):
		if s.dispatched["delete"] {
			return "", denied
		}
		s.dispatched["delete"] = true
		return "delete", nil
	case s.config.Image == pinnedImage && method == "POST" && path == base+"/exec" && q == "" && validateExec(body) == nil:
		if s.execAttempted || s.execCount >= 64 {
			return "", denied
		}
		s.execAttempted = true
		s.execCount++
		s.execID = ""
		s.execTerminal = false
		delete(s.dispatched, "exec-start")
		return "exec-create", nil
	}
	if s.execID != "" && path == "/exec/"+s.execID+"/start" && method == "POST" && q == "" {
		v, err := strictJSON(body)
		obj, ok := v.(map[string]any)
		if err != nil || !ok || !keys(obj, "Detach", "Tty") || obj["Detach"] != false || obj["Tty"] != false || s.dispatched["exec-start"] {
			return "", denied
		}
		s.dispatched["exec-start"] = true
		return "exec-start", nil
	}
	if s.execID != "" && s.dispatched["exec-start"] && path == "/exec/"+s.execID+"/json" && method == "GET" && q == "" && len(body) == 0 {
		return "exec-inspect", nil
	}
	return "", denied
}

// The diagnostic endpoint emits only event kinds, never daemon-supplied
// attributes. The daemon query is scoped to the one container of this lease.
func (s *relay) fixtureEvents() ([]byte, error) {
	s.mu.Lock()
	id := s.container
	closed := s.closed || !s.leaseActive
	s.mu.Unlock()
	if closed || !hex64.MatchString(id) {
		return nil, denied
	}
	filters, _ := json.Marshal(map[string][]string{"container": {id}, "type": {"container"}})
	q := url.Values{"since": {"0"}, "until": {fmt.Sprint(time.Now().Unix() + 1)}, "filters": {string(filters)}}
	ctx, cancel := context.WithTimeout(s.ctx, 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", "http://docker/events?"+q.Encode(), nil)
	if err != nil {
		return nil, denied
	}
	response, err := s.transport.RoundTrip(req)
	if err != nil {
		return nil, denied
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, denied
	}
	return fixtureEventTypes(io.LimitReader(response.Body, maxBody+1), id)
}

func fixtureEventTypes(reader io.Reader, id string) ([]byte, error) {
	data, err := io.ReadAll(reader)
	if err != nil || len(data) > maxBody {
		return nil, denied
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	events := make([]string, 0)
	for count := 0; ; count++ {
		var event struct {
			Type   string
			Action string
			Actor  struct{ ID string }
		}
		err := decoder.Decode(&event)
		if err == io.EOF {
			break
		}
		if err != nil || count >= 4096 || event.Type != "container" || event.Actor.ID != id {
			return nil, denied
		}
		switch event.Action {
		case "create", "start", "die", "destroy":
			events = append(events, event.Action)
		}
	}
	return json.Marshal(events)
}

func parseCreated(body []byte, wantWarnings bool) (string, error) {
	value, err := strictJSON(body)
	if err != nil {
		return "", denied
	}
	obj, ok := value.(map[string]any)
	if !ok || !keys(obj, "Id", "Warnings") {
		return "", denied
	}
	id, ok := obj["Id"].(string)
	if !ok || !hex64.MatchString(id) {
		return "", denied
	}
	if !wantWarnings && obj["Warnings"] != nil {
		return "", denied
	}
	if wantWarnings {
		if warnings := obj["Warnings"]; warnings != nil {
			a, ok := warnings.([]any)
			if !ok || len(a) != 0 {
				return "", denied
			}
		}
	}
	return id, nil
}

func readHeader(reader *bufio.Reader) ([]byte, error) {
	var header []byte
	for {
		line, err := reader.ReadSlice('\n')
		if err != nil || len(line) < 2 || line[len(line)-2] != '\r' || len(header)+len(line) > maxHeader {
			return nil, denied
		}
		header = append(header, line...)
		if bytes.Equal(line, []byte("\r\n")) {
			return header, nil
		}
	}
}
func validateHeaders(r *http.Request) bool {
	for name, values := range r.Header {
		switch http.CanonicalHeaderKey(name) {
		case "User-Agent", "Accept", "Accept-Encoding", "Content-Type", "Content-Length", "Connection", "Upgrade", "Docker-Api-Version":
			if len(values) != 1 || strings.ContainsAny(values[0], "\r\n\x00") {
				return false
			}
		default:
			return false
		}
	}
	return true
}

type boundedResponse struct {
	source io.ReadCloser
	left   int64
}

func (b *boundedResponse) Read(p []byte) (int, error) {
	if b.left <= 0 {
		var one [1]byte
		n, err := b.source.Read(one[:])
		if n != 0 {
			return 0, denied
		}
		return 0, err
	}
	if int64(len(p)) > b.left {
		p = p[:b.left]
	}
	n, err := b.source.Read(p)
	b.left -= int64(n)
	return n, err
}
func (b *boundedResponse) Close() error { return b.source.Close() }

func (s *relay) serve(conn net.Conn) {
	s.mu.Lock()
	if s.closed || !s.leaseActive || len(s.connections) >= 16 {
		s.mu.Unlock()
		conn.Close()
		return
	}
	s.connections[conn] = struct{}{}
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.connections, conn); s.mu.Unlock(); conn.Close() }()
	reader := bufio.NewReaderSize(conn, 4096)
	if auth(conn, reader, s.config, s.key, "turnlink-vm-docker-v1", "turnlink-vm-docker-ready-v1") != nil {
		return
	}
	for count := 0; count < 64; count++ {
		timer := time.AfterFunc(30*time.Second, func() { conn.Close() })
		conn.SetReadDeadline(time.Now().Add(30 * time.Second))
		header, err := readHeader(reader)
		if err != nil {
			timer.Stop()
			return
		}
		reader = bufio.NewReaderSize(io.MultiReader(bytes.NewReader(header), reader), 4096)
		request, err := http.ReadRequest(reader)
		if err != nil {
			timer.Stop()
			return
		}
		if request.ContentLength > maxBody || request.Method == "CONNECT" || !validateHeaders(request) {
			timer.Stop()
			return
		}
		body, err := io.ReadAll(io.LimitReader(request.Body, maxBody+1))
		if err != nil || len(body) > maxBody {
			timer.Stop()
			return
		}
		request.Body.Close()
		timer.Stop()
		conn.SetReadDeadline(time.Time{})
		kind, err := s.admit(request, body)
		if err != nil {
			fmt.Fprint(conn, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
			return
		}
		if kind == "fixture-events" {
			result, err := s.fixtureEvents()
			if err != nil {
				return
			}
			if _, err = fmt.Fprintf(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(result), result); err != nil {
				return
			}
			return
		}
		if kind == "exec-ticket" {
			s.mu.Lock()
			id, closed := s.execID, s.closed
			s.mu.Unlock()
			if closed || id == "" {
				return
			}
			data, _ := json.Marshal(map[string]string{"id": id})
			fmt.Fprintf(conn, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(data), data)
			return
		}
		if kind == "exec-ack" {
			fmt.Fprint(conn, "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
			return
		}
		outgoing := request.Clone(s.ctx)
		outgoing.RequestURI = ""
		outgoing.URL.Scheme = "http"
		outgoing.URL.Host = "docker"
		outgoing.Host = "docker"
		// A non-nil arbitrary reader with ContentLength 0 is serialized by
		// net/http as chunked. Docker rejects a chunked container-start body,
		// even when it contains zero bytes. Preserve a genuinely empty body.
		outgoing.Body = http.NoBody
		if len(body) > 0 {
			outgoing.Body = io.NopCloser(bytes.NewReader(body))
		}
		outgoing.ContentLength = int64(len(body))
		outgoing.TransferEncoding = nil
		outgoing.Close = false
		outgoing.Header = make(http.Header)
		if len(body) > 0 {
			outgoing.Header.Set("Content-Type", "application/json")
		}
		if (kind == "attach" || kind == "exec-start") && strings.EqualFold(request.Header.Get("Upgrade"), "tcp") {
			outgoing.Header.Set("Connection", "Upgrade")
			outgoing.Header.Set("Upgrade", "tcp")
		}
		if s.ctx.Err() != nil {
			return
		}
		response, err := s.transport.RoundTrip(outgoing)
		if err != nil {
			return
		}
		if kind == "create" || kind == "exec-create" {
			if response.StatusCode != http.StatusCreated {
				response.Body.Close()
				return
			}
			content, err := io.ReadAll(io.LimitReader(response.Body, maxBody+1))
			response.Body.Close()
			if err != nil || len(content) > maxBody {
				return
			}
			id, err := parseCreated(content, kind == "create")
			if err != nil {
				return
			}
			s.mu.Lock()
			if s.closed {
				s.mu.Unlock()
				return
			}
			if kind == "create" {
				s.container = id
			} else {
				if s.execSeen[id] {
					s.mu.Unlock()
					return
				}
				s.execSeen[id] = true
				s.execID = id
			}
			s.mu.Unlock()
			response.Body = io.NopCloser(bytes.NewReader(content))
			response.ContentLength = int64(len(content))
			response.TransferEncoding = nil
		}
		if kind == "inspect" && response.StatusCode == http.StatusOK {
			content, err := io.ReadAll(io.LimitReader(response.Body, maxBody+1))
			response.Body.Close()
			if err != nil || len(content) > maxBody {
				return
			}
			value, err := strictJSON(content)
			object, ok := value.(map[string]any)
			s.mu.Lock()
			id := s.container
			closed := s.closed
			s.mu.Unlock()
			if err != nil || !ok || closed || object["Id"] != id {
				return
			}
			response.Body = io.NopCloser(bytes.NewReader(content))
			response.ContentLength = int64(len(content))
			response.TransferEncoding = nil
		}
		// Repeated fixed hash probes are permitted only after the previous exec
		// has a definitive successful terminal inspect. Lost/uncertain results
		// retain the intent and block another dispatch for this lease.
		var completedExec string
		if kind == "exec-inspect" && response.StatusCode == http.StatusOK {
			content, err := io.ReadAll(io.LimitReader(response.Body, maxBody+1))
			response.Body.Close()
			if err != nil || len(content) > maxBody {
				return
			}
			value, err := strictJSON(content)
			object, ok := value.(map[string]any)
			if err != nil || !ok {
				return
			}
			s.mu.Lock()
			id := s.execID
			closed := s.closed
			s.mu.Unlock()
			if closed || (object["ID"] != nil && object["ID"] != id) {
				return
			}
			if object["Running"] == false && object["ExitCode"] == json.Number("0") {
				completedExec = id
			}
			response.Body = io.NopCloser(bytes.NewReader(content))
			response.ContentLength = int64(len(content))
			response.TransferEncoding = nil
		}
		if response.StatusCode == http.StatusSwitchingProtocols {
			if kind != "attach" && kind != "exec-start" {
				response.Body.Close()
				return
			}
			duplex, ok := response.Body.(io.ReadWriteCloser)
			if !ok {
				response.Body.Close()
				return
			}
			if _, err := fmt.Fprintf(conn, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n"); err != nil {
				duplex.Close()
				return
			}
			// The allowlisted exec has AttachStdin=false. The CLI closes its
			// write half after the request; closing a wrapped upstream duplex on
			// that EOF would discard its still-pending stdout/stderr.
			if kind == "attach" {
				go func() {
					io.Copy(duplex, reader)
					if half, ok := duplex.(interface{ CloseWrite() error }); ok {
						half.CloseWrite()
					} else {
						duplex.Close()
					}
				}()
			}
			io.Copy(conn, duplex)
			if half, ok := conn.(interface{ CloseWrite() error }); ok {
				half.CloseWrite()
			}
			duplex.Close()
			return
		}
		if kind == "attach" {
			response.Body.Close()
			return
		}
		response.Body = &boundedResponse{source: response.Body, left: maxResponse}
		err = response.Write(conn)
		response.Body.Close()
		if err == nil && completedExec != "" {
			s.mu.Lock()
			if !s.closed && s.execID == completedExec {
				s.execTerminal = true
			}
			s.mu.Unlock()
		}
		if err != nil || request.Close || response.Close {
			return
		}
	}
}
