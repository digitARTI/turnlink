package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func fixtureConfig() config {
	c := config{GrantScope: strings.Repeat("a", 64), Image: pinnedImage, Name: "turnlink-plugin-test-12345678-1234-4234-8234-123456789abc", SessionID: "ses_fixture", Directory: "/synthetic"}
	c.Scope = c.expectedScope()
	return c
}
func createObject(c config) map[string]any {
	return map[string]any{
		"Hostname": "", "Domainname": "", "User": "10001:10001", "AttachStdin": true, "AttachStdout": true, "AttachStderr": true,
		"Tty": false, "OpenStdin": true, "StdinOnce": true, "Cmd": c.command(), "Image": c.Image, "Volumes": map[string]any{}, "WorkingDir": "", "Entrypoint": []string{"/usr/bin/env"}, "Labels": map[string]any{},
		"HostConfig": map[string]any{"Binds": nil, "LogConfig": map[string]any{"Type": "", "Config": map[string]any{}}, "NetworkMode": "none", "PortBindings": map[string]any{},
			"RestartPolicy": map[string]any{"Name": "no", "MaximumRetryCount": 0}, "AutoRemove": true, "ConsoleSize": []int{0, 0}, "CapAdd": nil, "CapDrop": []string{"ALL"},
			"ReadonlyRootfs": true, "SecurityOpt": []string{"no-new-privileges"}, "Devices": []any{}, "DeviceRequests": nil, "MemorySwappiness": -1},
		"NetworkingConfig": map[string]any{"EndpointsConfig": map[string]any{}},
	}
}
func encoded(v any) []byte { b, _ := json.Marshal(v); return b }
func roundTripper(f func(*http.Request) (*http.Response, error)) http.RoundTripper {
	return roundTripFunc(f)
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Status: fmt.Sprintf("%d %s", status, http.StatusText(status)), Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), ContentLength: int64(len(body)), Proto: "HTTP/1.1", ProtoMajor: 1, ProtoMinor: 1}
}

func TestStrictJSON(t *testing.T) {
	for _, body := range []string{`{"x":1,"x":2}`, `{"x":{"v":1,"\u0076":2}}`, `{"x":1} {}`, `{"x":`, strings.Repeat(" ", maxBody+1)} {
		if _, err := strictJSON([]byte(body)); err == nil {
			t.Fatalf("accepted %s", body)
		}
	}
	if _, err := strictJSON([]byte(`{"x":{"v":1},"y":[]}`)); err != nil {
		t.Fatal(err)
	}
}

func TestHostInteroperabilityVector(t *testing.T) {
	c := fixtureConfig()
	if c.Scope != "d4a1238e429c4229a3af5878217e71457e31664d5d734d394e0ccda293c3959b" {
		t.Fatal("host scope differs")
	}
	if mac(bytes.Repeat([]byte{7}, 32), "turnlink-vm-docker-v1", c.Scope, strings.Repeat("c", 64), strings.Repeat("b", 64)) != "0a382a3fc8fa2ddf2a9277652aa5c69ade595db0ceb207c764c5d4c37fd537d4" {
		t.Fatal("host HMAC differs")
	}
}

func TestAuthenticatedControlLeaseGatesDispatch(t *testing.T) {
	c := fixtureConfig()
	key := bytes.Repeat([]byte{7}, 32)
	s, err := newRelay(c, key, roundTripper(func(*http.Request) (*http.Response, error) { return nil, denied }))
	if err != nil {
		t.Fatal(err)
	}
	defer s.revoke()
	if _, err = s.admit(request("GET", "/_ping"), nil); err == nil {
		t.Fatal("dispatch before lease")
	}
	host, guest := net.Pipe()
	done := make(chan error, 1)
	go func() { done <- s.holdLease(guest) }()
	authenticateDomain(t, host, c, key, false, "turnlink-vm-docker-lease-v1", "turnlink-vm-docker-lease-ready-v1")
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	if _, err = s.admit(request("GET", "/_ping"), nil); err != nil {
		t.Fatal(err)
	}
	host.Close()
	select {
	case <-s.ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("control loss did not revoke")
	}
	if _, err = s.admit(request("GET", "/_ping"), nil); err == nil {
		t.Fatal("dispatch after lease loss")
	}
}

func TestDataAuthenticationCannotOpenControlLease(t *testing.T) {
	c := fixtureConfig()
	key := bytes.Repeat([]byte{7}, 32)
	s, _ := newRelay(c, key, roundTripper(func(*http.Request) (*http.Response, error) { return nil, denied }))
	defer s.revoke()
	host, guest := net.Pipe()
	defer host.Close()
	done := make(chan error, 1)
	go func() { done <- s.holdLease(guest) }()
	rd := bufio.NewReader(host)
	var challenge struct{ Challenge string }
	line, err := rd.ReadBytes('\n')
	if err != nil || json.Unmarshal(line, &challenge) != nil {
		t.Fatal("no challenge")
	}
	nonce := strings.Repeat("b", 64)
	tag := mac(key, "turnlink-vm-docker-v1", c.Scope, challenge.Challenge, nonce)
	fmt.Fprintf(host, "{\"version\":1,\"type\":\"authenticate\",\"scope\":%q,\"nonce\":%q,\"tag\":%q}\n", c.Scope, nonce, tag)
	if <-done == nil {
		t.Fatal("data-domain tag opened lease")
	}
	if _, err = s.admit(request("GET", "/_ping"), nil); err == nil {
		t.Fatal("dispatch after wrong domain")
	}
}

func TestSingleUseLeaseSurvivesRestart(t *testing.T) {
	c := fixtureConfig()
	dir := t.TempDir() + "/leases"
	if claimLease(dir, c) != nil {
		t.Fatal("first lease denied")
	}
	if claimLease(dir, c) == nil {
		t.Fatal("same lease reused after restart")
	}
	other := c
	other.GrantScope = strings.Repeat("b", 64)
	other.Scope = other.expectedScope()
	if claimLease(dir, other) != nil {
		t.Fatal("independent lease denied")
	}
}
func TestCreateWhitelist(t *testing.T) {
	c := fixtureConfig()
	if err := validateCreate(c, encoded(createObject(c))); err != nil {
		t.Fatal("captured harmless defaults rejected")
	}
	changes := map[string]func(map[string]any){
		"image": func(x map[string]any) { x["Image"] = "alpine" }, "user": func(x map[string]any) { x["User"] = "0" },
		"command": func(x map[string]any) { x["Cmd"] = []string{"sh"} }, "entrypoint": func(x map[string]any) { x["Entrypoint"] = []string{"sh"} },
		"unknown": func(x map[string]any) { x["FutureCapability"] = true }, "env": func(x map[string]any) { x["Env"] = []string{"HOME=/"} },
		"mount":      func(x map[string]any) { x["HostConfig"].(map[string]any)["Binds"] = []string{"/:/host"} },
		"network":    func(x map[string]any) { x["HostConfig"].(map[string]any)["NetworkMode"] = "host" },
		"privileged": func(x map[string]any) { x["HostConfig"].(map[string]any)["Privileged"] = true },
		"capadd":     func(x map[string]any) { x["HostConfig"].(map[string]any)["CapAdd"] = []string{"SYS_ADMIN"} },
		"device": func(x map[string]any) {
			x["HostConfig"].(map[string]any)["DeviceRequests"] = []any{map[string]any{"Count": -1}}
		},
		"restart": func(x map[string]any) {
			x["HostConfig"].(map[string]any)["RestartPolicy"] = map[string]any{"Name": "always", "MaximumRetryCount": 0}
		},
		"unknownNested": func(x map[string]any) {
			x["HostConfig"].(map[string]any)["LogConfig"] = map[string]any{"Type": "", "Config": map[string]any{}, "opaque": true}
		},
		"endpoint": func(x map[string]any) {
			x["NetworkingConfig"] = map[string]any{"EndpointsConfig": map[string]any{"bridge": map[string]any{}}}
		},
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			x := createObject(c)
			change(x)
			if validateCreate(c, encoded(x)) == nil {
				t.Fatal("unsafe create accepted")
			}
		})
	}
}

func TestDestinationProfilePinsImageCommandAndWritableMounts(t *testing.T) {
	c := fixtureConfig()
	c.Image = destinationImage
	c.Directory = "/project"
	c.Scope = c.expectedScope()
	if !c.valid() {
		t.Fatal("destination config rejected")
	}
	good := createObject(c)
	host := good["HostConfig"].(map[string]any)
	host["PidsLimit"] = 64
	host["Tmpfs"] = map[string]any{"/state": "rw,nosuid,nodev,uid=10001,gid=10001,mode=0700", "/tmp": "rw,nosuid,nodev,uid=10001,gid=10001,mode=0700"}
	if err := validateCreate(c, encoded(good)); err != nil {
		t.Fatal("destination create rejected")
	}
	for _, mutate := range []func(map[string]any){
		func(x map[string]any) { x["Image"] = pinnedImage },
		func(x map[string]any) { x["Cmd"] = []string{"/bin/sh"} },
		func(x map[string]any) { x["HostConfig"].(map[string]any)["PidsLimit"] = 65 },
		func(x map[string]any) {
			x["HostConfig"].(map[string]any)["Tmpfs"] = map[string]any{"/state": "rw", "/tmp": "rw"}
		},
		func(x map[string]any) { x["HostConfig"].(map[string]any)["Binds"] = []string{"/:/host"} },
	} {
		var copy map[string]any
		if err := json.Unmarshal(encoded(good), &copy); err != nil {
			t.Fatal(err)
		}
		mutate(copy)
		if validateCreate(c, encoded(copy)) == nil {
			t.Fatal("altered destination create accepted")
		}
	}
	s, err := newRelay(c, make([]byte, 32), roundTripper(func(*http.Request) (*http.Response, error) { return nil, denied }))
	if err != nil {
		t.Fatal(err)
	}
	defer s.revoke()
	s.leaseActive = true
	s.container = strings.Repeat("1", 64)
	if _, err = s.admit(request("POST", "/containers/"+s.container+"/exec"), encoded(map[string]any{"User": "10001:10001",
		"AttachStdout": true, "AttachStderr": true, "Cmd": []string{"/usr/local/bin/turnlink-node", "-e", hashScript}})); err == nil {
		t.Fatal("destination profile allowed exec")
	}
}
func TestExecWhitelist(t *testing.T) {
	good := map[string]any{"User": "10001:10001", "AttachStdin": false, "AttachStdout": true, "AttachStderr": true, "Tty": false, "Cmd": []string{"/usr/local/bin/turnlink-node", "-e", hashScript}}
	if validateExec(encoded(good)) != nil {
		t.Fatal("fixture exec denied")
	}
	for _, name := range []string{"User", "Cmd", "Env", "Privileged", "unknown"} {
		x := map[string]any{}
		for k, v := range good {
			x[k] = v
		}
		switch name {
		case "User":
			x[name] = "0"
		case "Cmd":
			x[name] = []string{"sh"}
		case "Env":
			x[name] = []string{"X=1"}
		case "Privileged":
			x[name] = true
		default:
			x[name] = true
		}
		if validateExec(encoded(x)) == nil {
			t.Fatalf("accepted %s", name)
		}
	}
}
func request(method, target string) *http.Request {
	u, _ := url.Parse(target)
	return &http.Request{Method: method, URL: u}
}
func TestLeaseDispatchAndScope(t *testing.T) {
	c := fixtureConfig()
	s, err := newRelay(c, make([]byte, 32), roundTripper(func(*http.Request) (*http.Response, error) { return nil, denied }))
	if err != nil {
		t.Fatal(err)
	}
	s.leaseActive = true
	defer s.revoke()
	if _, err = s.admit(request("HEAD", "/_ping"), nil); err != nil {
		t.Fatal(err)
	}
	if _, err = s.admit(request("GET", "/containers/"+strings.Repeat("1", 64)+"/json"), nil); err == nil {
		t.Fatal("foreign container accepted")
	}
	create := request("POST", "/v1.47/containers/create?name="+c.Name)
	if _, err = s.admit(create, encoded(createObject(c))); err != nil {
		t.Fatal(err)
	}
	if _, err = s.admit(create, encoded(createObject(c))); err == nil {
		t.Fatal("create retried after possible dispatch")
	}
	s.container = strings.Repeat("1", 64)
	id := s.container
	if _, err = s.admit(request("GET", "/turnlink-fixture/events"), nil); err != nil {
		t.Fatal(err)
	}
	if _, err = s.admit(request("GET", "/turnlink-fixture/events?container=other"), nil); err == nil {
		t.Fatal("event filter override accepted")
	}
	if _, err = s.admit(request("POST", "/containers/"+id+"/start"), nil); err != nil {
		t.Fatal(err)
	}
	if _, err = s.admit(request("POST", "/containers/"+id+"/start"), nil); err == nil {
		t.Fatal("start replay accepted")
	}
	if _, err = s.admit(request("POST", "/containers/"+id+"/attach?stdin=1&stdout=1&stderr=1&stream=1"), nil); err != nil {
		t.Fatal(err)
	}
	if _, err = s.admit(request("POST", "/containers/"+id+"/exec"), encoded(map[string]any{"User": "10001:10001", "AttachStdout": true, "AttachStderr": true, "Cmd": []string{"/usr/local/bin/turnlink-node", "-e", hashScript}})); err != nil {
		t.Fatal(err)
	}
	if _, err = s.admit(request("POST", "/exec/"+strings.Repeat("2", 64)+"/start"), []byte(`{"Detach":false,"Tty":false}`)); err == nil {
		t.Fatal("foreign exec accepted")
	}
	s.execID = strings.Repeat("2", 64)
	if _, err = s.admit(request("POST", "/exec/"+s.execID+"/start"), []byte(`{"Detach":false,"Tty":false}`)); err != nil {
		t.Fatal(err)
	}
	s.revoke()
	if _, err = s.admit(request("GET", "/_ping"), nil); err == nil {
		t.Fatal("revoked lease accepted")
	}
	modified := c
	modified.Directory = "/other"
	if modified.valid() {
		t.Fatal("scope did not bind directory")
	}
}

func TestFixtureEventTypesRedactAndScope(t *testing.T) {
	id := strings.Repeat("1", 64)
	body := fmt.Sprintf("{\"Type\":\"container\",\"Action\":\"create\",\"Actor\":{\"ID\":%q,\"Attributes\":{\"secret\":\"never-return\"}}}\n{\"Type\":\"container\",\"Action\":\"attach\",\"Actor\":{\"ID\":%q}}\n", id, id)
	result, err := fixtureEventTypes(strings.NewReader(body), id)
	if err != nil || string(result) != `["create"]` {
		t.Fatalf("unexpected diagnostic output %q %v", result, err)
	}
	if _, err := fixtureEventTypes(strings.NewReader(body), strings.Repeat("2", 64)); err == nil {
		t.Fatal("foreign container events accepted")
	}
	if _, err := fixtureEventTypes(strings.NewReader("{"), id); err == nil {
		t.Fatal("truncated event accepted")
	}
}

func TestHashProbeAcknowledgementIsScopedSingleUseAndBounded(t *testing.T) {
	c := fixtureConfig()
	s, err := newRelay(c, make([]byte, 32), roundTripper(func(*http.Request) (*http.Response, error) { return nil, denied }))
	if err != nil {
		t.Fatal(err)
	}
	defer s.revoke()
	s.leaseActive = true
	s.container = strings.Repeat("1", 64)
	execBody := encoded(map[string]any{"User": "10001:10001", "AttachStdout": true, "AttachStderr": true,
		"Cmd": []string{"/usr/local/bin/turnlink-node", "-e", hashScript}})
	create := request("POST", "/containers/"+s.container+"/exec")
	if _, err = s.admit(create, execBody); err != nil {
		t.Fatal(err)
	}
	if _, err = s.admit(create, execBody); err == nil {
		t.Fatal("uncertain exec was retried")
	}
	s.execID = strings.Repeat("2", 64)
	if _, err = s.admit(request("GET", "/turnlink-fixture/exec-ticket"), nil); err == nil {
		t.Fatal("ticket before terminal inspect")
	}
	s.execTerminal = true
	if _, err = s.admit(request("POST", "/turnlink-fixture/exec-ack"), encoded(map[string]any{"id": strings.Repeat("3", 64)})); err == nil {
		t.Fatal("wrong ack accepted")
	}
	var accepted atomic.Int32
	var group sync.WaitGroup
	for i := 0; i < 16; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			if _, e := s.admit(request("POST", "/turnlink-fixture/exec-ack"), encoded(map[string]any{"id": strings.Repeat("2", 64)})); e == nil {
				accepted.Add(1)
			}
		}()
	}
	group.Wait()
	if accepted.Load() != 1 {
		t.Fatalf("accepted %d acknowledgements", accepted.Load())
	}
	if _, err = s.admit(create, execBody); err != nil {
		t.Fatal("new probe after ack rejected")
	}
	s.execAttempted = false
	s.execCount = 64
	if _, err = s.admit(create, execBody); err == nil {
		t.Fatal("probe limit bypassed")
	}
}

func TestHashProbeTerminalInspectMustBeDeliveredBeforeAcknowledgement(t *testing.T) {
	c := fixtureConfig()
	key := bytes.Repeat([]byte{7}, 32)
	id := strings.Repeat("2", 64)
	transport := roundTripper(func(r *http.Request) (*http.Response, error) {
		return response(http.StatusOK, `{"ID":"`+id+`","Running":false,"ExitCode":0}`), nil
	})
	makeRelay := func() *relay {
		s, err := newRelay(c, key, transport)
		if err != nil {
			t.Fatal(err)
		}
		s.leaseActive = true
		s.container = strings.Repeat("1", 64)
		s.execID = id
		s.execAttempted = true
		s.dispatched["exec-start"] = true
		return s
	}
	s := makeRelay()
	defer s.revoke()
	host, guest := net.Pipe()
	defer host.Close()
	go s.serve(guest)
	rd := authenticate(t, host, c, key, false)
	fmt.Fprintf(host, "GET /v1.47/exec/%s/json HTTP/1.1\r\nHost: docker\r\nConnection: close\r\n\r\n", id)
	got, err := http.ReadResponse(rd, nil)
	if err != nil || got.StatusCode != http.StatusOK {
		t.Fatalf("inspect failed: %v", err)
	}
	io.Copy(io.Discard, got.Body)
	got.Body.Close()
	deadline := time.Now().Add(time.Second)
	for {
		s.mu.Lock()
		terminal := s.execTerminal
		s.mu.Unlock()
		if terminal {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("terminal state not recorded")
		}
		time.Sleep(time.Millisecond)
	}
	if _, err = s.admit(request("GET", "/turnlink-fixture/exec-ticket"), nil); err != nil {
		t.Fatal("terminal ticket unavailable")
	}
	if _, err = s.admit(request("POST", "/turnlink-fixture/exec-ack"), encoded(map[string]any{"id": id})); err != nil {
		t.Fatal("valid acknowledgement rejected")
	}

	other := makeRelay()
	defer other.revoke()
	host2, guest2 := net.Pipe()
	done := make(chan struct{})
	go func() { other.serve(guest2); close(done) }()
	_ = authenticate(t, host2, c, key, false)
	fmt.Fprintf(host2, "GET /v1.47/exec/%s/json HTTP/1.1\r\nHost: docker\r\nConnection: close\r\n\r\n", id)
	host2.Close()
	<-done
	if _, err = other.admit(request("GET", "/turnlink-fixture/exec-ticket"), nil); err == nil {
		t.Fatal("lost response allowed a ticket")
	}
}

func TestConcurrentCreateOnlyAdmitsOne(t *testing.T) {
	c := fixtureConfig()
	s, _ := newRelay(c, make([]byte, 32), roundTripper(func(*http.Request) (*http.Response, error) { return nil, denied }))
	defer s.revoke()
	s.leaseActive = true
	var admitted atomic.Int32
	var group sync.WaitGroup
	for i := 0; i < 32; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			if _, err := s.admit(request("POST", "/containers/create?name="+c.Name), encoded(createObject(c))); err == nil {
				admitted.Add(1)
			}
		}()
	}
	group.Wait()
	if admitted.Load() != 1 {
		t.Fatalf("admitted %d creates", admitted.Load())
	}
}

func authenticate(t *testing.T, conn net.Conn, c config, key []byte, wrong bool) *bufio.Reader {
	return authenticateDomain(t, conn, c, key, wrong, "turnlink-vm-docker-v1", "turnlink-vm-docker-ready-v1")
}
func authenticateDomain(t *testing.T, conn net.Conn, c config, key []byte, wrong bool, domain, readyDomain string) *bufio.Reader {
	t.Helper()
	reader := bufio.NewReader(conn)
	raw, err := reader.ReadBytes('\n')
	if err != nil {
		t.Fatal(err)
	}
	var challenge struct {
		Version                int `json:"version"`
		Type, Scope, Challenge string
	}
	if json.Unmarshal(raw, &challenge) != nil || challenge.Scope != c.Scope {
		t.Fatal("bad challenge")
	}
	nonce := strings.Repeat("b", 64)
	tag := mac(key, domain, c.Scope, challenge.Challenge, nonce)
	if wrong {
		tag = strings.Repeat("0", 64)
	}
	fmt.Fprintf(conn, "{\"version\":1,\"type\":\"authenticate\",\"scope\":%q,\"nonce\":%q,\"tag\":%q}\n", c.Scope, nonce, tag)
	if wrong {
		return reader
	}
	raw, err = reader.ReadBytes('\n')
	if err != nil {
		t.Fatal(err)
	}
	var ready struct {
		Version          int `json:"version"`
		Type, Scope, Tag string
	}
	if json.Unmarshal(raw, &ready) != nil || ready.Type != "ready" || ready.Scope != c.Scope || ready.Tag != mac(key, readyDomain, c.Scope, challenge.Challenge, nonce) {
		t.Fatal("bad ready")
	}
	return reader
}
func TestRealStreamAndRevocation(t *testing.T) {
	c := fixtureConfig()
	key := bytes.Repeat([]byte{7}, 32)
	var dispatched atomic.Int32
	entered := make(chan struct{}, 1)
	transport := roundTripper(func(r *http.Request) (*http.Response, error) {
		dispatched.Add(1)
		if r.URL.Path == "/containers/create" || strings.HasSuffix(r.URL.Path, "/containers/create") {
			return response(201, `{"Id":"`+strings.Repeat("1", 64)+`","Warnings":[]}`), nil
		}
		if strings.HasSuffix(r.URL.Path, "/start") {
			entered <- struct{}{}
			<-r.Context().Done()
			return nil, r.Context().Err()
		}
		return response(200, "OK"), nil
	})
	s, err := newRelay(c, key, transport)
	if err != nil {
		t.Fatal(err)
	}
	s.leaseActive = true
	defer s.revoke()
	host, guest := net.Pipe()
	go s.serve(guest)
	rd := authenticate(t, host, c, key, false)
	body := encoded(createObject(c))
	fmt.Fprintf(host, "POST /v1.47/containers/create?name=%s HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s", c.Name, len(body), body)
	got, err := http.ReadResponse(rd, nil)
	if err != nil || got.StatusCode != 201 {
		t.Fatalf("create: %v dispatches=%d attempted=%v", err, dispatched.Load(), s.createAttempted)
	}
	io.Copy(io.Discard, got.Body)
	got.Body.Close()
	fmt.Fprintf(host, "POST /v1.47/containers/%s/start HTTP/1.1\r\nHost: docker\r\nContent-Length: 0\r\n\r\n", strings.Repeat("1", 64))
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("start not dispatched")
	}
	s.revoke()
	host.SetReadDeadline(time.Now().Add(time.Second))
	if _, err = rd.ReadByte(); err == nil {
		t.Fatal("revocation did not close in-flight stream")
	}
	host.Close()
	if dispatched.Load() != 2 {
		t.Fatalf("unexpected dispatches: %d", dispatched.Load())
	}
	nextHost, nextGuest := net.Pipe()
	defer nextHost.Close()
	go s.serve(nextGuest)
	nextHost.SetReadDeadline(time.Now().Add(time.Second))
	if _, err = nextHost.Read(make([]byte, 1)); err == nil {
		t.Fatal("revoked connection accepted")
	}
}

func TestEmptyStartIsForwardedWithoutChunkedBody(t *testing.T) {
	c := fixtureConfig()
	key := bytes.Repeat([]byte{7}, 32)
	wireResult := make(chan error, 1)
	transport := roundTripper(func(r *http.Request) (*http.Response, error) {
		var wire bytes.Buffer
		if err := r.Write(&wire); err != nil {
			wireResult <- err
			return nil, err
		}
		forwarded, err := http.ReadRequest(bufio.NewReader(&wire))
		if err == nil && (forwarded.ContentLength != 0 || len(forwarded.TransferEncoding) != 0) {
			err = fmt.Errorf("empty start forwarded with content length %d and transfer encodings %v", forwarded.ContentLength, forwarded.TransferEncoding)
		}
		wireResult <- err
		return response(http.StatusNoContent, ""), nil
	})
	s, err := newRelay(c, key, transport)
	if err != nil {
		t.Fatal(err)
	}
	s.leaseActive = true
	s.container = strings.Repeat("1", 64)
	defer s.revoke()
	host, guest := net.Pipe()
	defer host.Close()
	go s.serve(guest)
	rd := authenticate(t, host, c, key, false)
	fmt.Fprintf(host, "POST /v1.47/containers/%s/start HTTP/1.1\r\nHost: docker\r\nContent-Length: 0\r\n\r\n", s.container)
	got, err := http.ReadResponse(rd, nil)
	if err != nil || got.StatusCode != http.StatusNoContent {
		t.Fatalf("start response unavailable: %v", err)
	}
	got.Body.Close()
	if err = <-wireResult; err != nil {
		t.Fatal(err)
	}
}

func TestNonEmptyCreatePreservesBodyOnWire(t *testing.T) {
	c := fixtureConfig()
	key := bytes.Repeat([]byte{7}, 32)
	body := encoded(createObject(c))
	wireResult := make(chan error, 1)
	transport := roundTripper(func(r *http.Request) (*http.Response, error) {
		var wire bytes.Buffer
		if err := r.Write(&wire); err != nil {
			wireResult <- err
			return nil, err
		}
		forwarded, err := http.ReadRequest(bufio.NewReader(&wire))
		if err == nil {
			var actual []byte
			actual, err = io.ReadAll(forwarded.Body)
			if err == nil && (forwarded.ContentLength != int64(len(body)) || len(forwarded.TransferEncoding) != 0 || !bytes.Equal(actual, body)) {
				err = fmt.Errorf("create body or length changed on wire")
			}
		}
		wireResult <- err
		return response(http.StatusCreated, `{"Id":"`+strings.Repeat("1", 64)+`","Warnings":[]}`), nil
	})
	s, err := newRelay(c, key, transport)
	if err != nil {
		t.Fatal(err)
	}
	s.leaseActive = true
	defer s.revoke()
	host, guest := net.Pipe()
	defer host.Close()
	go s.serve(guest)
	rd := authenticate(t, host, c, key, false)
	fmt.Fprintf(host, "POST /v1.47/containers/create?name=%s HTTP/1.1\r\nHost: docker\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s", c.Name, len(body), body)
	got, err := http.ReadResponse(rd, nil)
	if err != nil || got.StatusCode != http.StatusCreated {
		t.Fatalf("create response unavailable: %v", err)
	}
	io.Copy(io.Discard, got.Body)
	got.Body.Close()
	if err = <-wireResult; err != nil {
		t.Fatal(err)
	}
}

func TestBadAuthenticationDoesNotDispatch(t *testing.T) {
	c := fixtureConfig()
	key := bytes.Repeat([]byte{7}, 32)
	var calls atomic.Int32
	s, _ := newRelay(c, key, roundTripper(func(*http.Request) (*http.Response, error) { calls.Add(1); return response(200, ""), nil }))
	s.leaseActive = true
	defer s.revoke()
	host, guest := net.Pipe()
	defer host.Close()
	go s.serve(guest)
	rd := authenticate(t, host, c, key, true)
	host.SetReadDeadline(time.Now().Add(time.Second))
	if _, err := rd.ReadByte(); err == nil {
		t.Fatal("bad MAC accepted")
	}
	if calls.Load() != 0 {
		t.Fatal("bad MAC dispatched")
	}
}

func TestAttachStreamsWithoutTruncation(t *testing.T) {
	c := fixtureConfig()
	key := bytes.Repeat([]byte{7}, 32)
	payload := bytes.Repeat([]byte("z"), 2*1024*1024)
	transport := roundTripper(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Upgrade") != "tcp" {
			return nil, denied
		}
		relaySide, daemonSide := net.Pipe()
		go func() {
			defer daemonSide.Close()
			buf := make([]byte, 5)
			if _, err := io.ReadFull(daemonSide, buf); err != nil || string(buf) != "hello" {
				return
			}
			daemonSide.Write(payload)
		}()
		return &http.Response{StatusCode: 101, Status: "101 Switching Protocols", Header: http.Header{"Connection": []string{"Upgrade"}, "Upgrade": []string{"tcp"}}, Body: relaySide, Proto: "HTTP/1.1", ProtoMajor: 1, ProtoMinor: 1}, nil
	})
	s, err := newRelay(c, key, transport)
	if err != nil {
		t.Fatal(err)
	}
	defer s.revoke()
	s.leaseActive = true
	s.container = strings.Repeat("1", 64)
	host, guest := net.Pipe()
	defer host.Close()
	go s.serve(guest)
	rd := authenticate(t, host, c, key, false)
	fmt.Fprintf(host, "POST /v1.47/containers/%s/attach?stdin=1&stdout=1&stderr=1&stream=1 HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Length: 0\r\n\r\n", s.container)
	header, err := readHeader(rd)
	if err != nil || !bytes.Contains(header, []byte("101 Switching Protocols")) {
		t.Fatal("upgrade failed")
	}
	go host.Write([]byte("hello"))
	received, err := io.ReadAll(rd)
	if err != nil || !bytes.Equal(received, payload) {
		t.Fatalf("attach truncated: %d %v", len(received), err)
	}
}

func TestExecOutputSurvivesClientWriteHalfClose(t *testing.T) {
	c := fixtureConfig()
	key := bytes.Repeat([]byte{7}, 32)
	payload := bytes.Repeat([]byte("x"), 65536)
	transport := roundTripper(func(r *http.Request) (*http.Response, error) {
		relaySide, daemonSide := net.Pipe()
		go func() {
			defer daemonSide.Close()
			time.Sleep(100 * time.Millisecond)
			_, _ = daemonSide.Write(payload)
		}()
		return &http.Response{StatusCode: 101, Status: "101 Switching Protocols", Header: http.Header{"Connection": []string{"Upgrade"}, "Upgrade": []string{"tcp"}}, Body: relaySide, Proto: "HTTP/1.1", ProtoMajor: 1, ProtoMinor: 1}, nil
	})
	s, err := newRelay(c, key, transport)
	if err != nil {
		t.Fatal(err)
	}
	defer s.revoke()
	s.leaseActive = true
	s.container = strings.Repeat("1", 64)
	s.execID = strings.Repeat("2", 64)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			s.serve(conn)
		}
	}()
	host, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer host.Close()
	rd := authenticate(t, host, c, key, false)
	body := `{"Detach":false,"Tty":false}`
	fmt.Fprintf(host, "POST /v1.47/exec/%s/start HTTP/1.1\r\nHost: docker\r\nConnection: Upgrade\r\nUpgrade: tcp\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s", s.execID, len(body), body)
	header, err := readHeader(rd)
	if err != nil || !bytes.Contains(header, []byte("101 Switching Protocols")) {
		t.Fatal("upgrade failed")
	}
	if err = host.(*net.TCPConn).CloseWrite(); err != nil {
		t.Fatal(err)
	}
	_ = host.SetReadDeadline(time.Now().Add(3 * time.Second))
	received, err := io.ReadAll(rd)
	if err != nil || !bytes.Equal(received, payload) {
		t.Fatalf("exec output truncated: %d %v", len(received), err)
	}
}

// Exercises the installed Docker CLI against a fake daemon and the relay;
// it never connects to the user's daemon. Opt-in because Docker may not be installed.
func TestDockerCLICreateAgainstFakeDaemon(t *testing.T) {
	if os.Getenv("TURNLINK_DOCKER_CLI_PROBE") != "1" {
		t.Skip("opt-in local Docker CLI fixture")
	}
	c := fixtureConfig()
	key := bytes.Repeat([]byte{7}, 32)
	id := strings.Repeat("1", 64)
	execID := strings.Repeat("2", 64)
	result := `{"bundle":"fixture","guard":"fixture"}` + "\n"
	transport := roundTripper(func(r *http.Request) (*http.Response, error) {
		if r.Method == "HEAD" && r.URL.Path == "/_ping" {
			v := response(200, "")
			v.Header.Set("Api-Version", "1.47")
			return v, nil
		}
		if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/containers/create") {
			return response(201, `{"Id":"`+id+`","Warnings":[]}`), nil
		}
		if r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/images/"+c.Image+"/json") {
			return response(200, `{"Id":"`+c.Image+`"}`), nil
		}
		if r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/info") {
			return response(200, `{"ID":"fixture-daemon"}`), nil
		}
		if r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/containers/"+id+"/json") {
			return response(200, `{"Id":"`+id+`","State":{"Running":true},"Config":{"Tty":false}}`), nil
		}
		if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/containers/"+id+"/exec") {
			return response(201, `{"Id":"`+execID+`"}`), nil
		}
		if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/exec/"+execID+"/start") {
			frame := make([]byte, 8)
			frame[0] = 1
			binary.BigEndian.PutUint32(frame[4:], uint32(len(result)))
			relay, daemon := net.Pipe()
			go func() { defer daemon.Close(); daemon.Write(append(frame, []byte(result)...)) }()
			return &http.Response{StatusCode: 101, Status: "101 Switching Protocols", Header: http.Header{"Connection": []string{"Upgrade"}, "Upgrade": []string{"tcp"}}, Body: relay, Proto: "HTTP/1.1", ProtoMajor: 1, ProtoMinor: 1}, nil
		}
		if r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/exec/"+execID+"/json") {
			return response(200, `{"Running":false,"ExitCode":0}`), nil
		}
		return response(404, ""), nil
	})
	s, err := newRelay(c, key, transport)
	if err != nil {
		t.Fatal(err)
	}
	defer s.revoke()
	s.leaseActive = true
	dir, err := os.MkdirTemp("/private/tmp", "turnlink-cli-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	socket := filepath.Join(dir, "docker.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			cli, e := listener.Accept()
			if e != nil {
				return
			}
			go func() {
				defer cli.Close()
				side, peer := net.Pipe()
				defer side.Close()
				go s.serve(peer)
				rd := bufio.NewReader(side)
				line, e := rd.ReadBytes('\n')
				if e != nil {
					return
				}
				var ch struct{ Challenge string }
				if json.Unmarshal(line, &ch) != nil {
					return
				}
				nonce := strings.Repeat("b", 64)
				tag := mac(key, "turnlink-vm-docker-v1", c.Scope, ch.Challenge, nonce)
				fmt.Fprintf(side, "{\"version\":1,\"type\":\"authenticate\",\"scope\":%q,\"nonce\":%q,\"tag\":%q}\n", c.Scope, nonce, tag)
				if _, e = rd.ReadBytes('\n'); e != nil {
					return
				}
				go io.Copy(side, cli)
				io.Copy(cli, rd)
			}()
		}
	}()
	args := []string{"--config", dir, "--host", "unix://" + socket, "create", "--rm", "-i", "--name", c.Name, "--network=none", "--read-only", "--user=10001:10001", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--entrypoint", "/usr/bin/env", c.Image}
	args = append(args, c.command()...)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "/opt/homebrew/bin/docker", args...)
	command.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + dir}
	out, err := command.CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != id {
		t.Fatalf("docker CLI create failed: %v, output %q", err, out)
	}
	args = []string{"--config", dir, "--host", "unix://" + socket, "image", "inspect", "--format", "{{.Id}}", c.Image}
	command = exec.CommandContext(ctx, "/opt/homebrew/bin/docker", args...)
	command.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + dir}
	out, err = command.CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != c.Image {
		t.Fatalf("docker CLI image inspection failed: %v, output %q", err, out)
	}
	args = []string{"--config", dir, "--host", "unix://" + socket, "info", "--format", "{{.ID}}"}
	command = exec.CommandContext(ctx, "/opt/homebrew/bin/docker", args...)
	command.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + dir}
	out, err = command.CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != "fixture-daemon" {
		t.Fatalf("docker CLI info failed: %v, output %q", err, out)
	}
	args = []string{"--config", dir, "--host", "unix://" + socket, "exec", "--user=10001:10001", id, "/usr/local/bin/turnlink-node", "-e", hashScript}
	command = exec.CommandContext(ctx, "/opt/homebrew/bin/docker", args...)
	command.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + dir}
	out, err = command.CombinedOutput()
	if err != nil || string(out) != result {
		t.Fatalf("docker CLI exec failed: %v, output %q", err, out)
	}
}
