// Fixture-only checkpoint transport. The receipt is not movement authorization.
package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const maxEnvelope = 6 * 1024 * 1024

var denied = errors.New("checkpoint fixture unavailable")
var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)
var targetName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`)

type config struct {
	VMInstance string `json:"vmInstance"`
	Importer   string `json:"importer"`
	Parent     string `json:"parent"`
	Target     string `json:"target"`
	ClaimDir   string `json:"claimDir"`
}
type auth struct {
	Version     int    `json:"version"`
	Type        string `json:"type"`
	VM          string `json:"vmInstance"`
	Challenge   string `json:"challenge"`
	EnvelopeSHA string `json:"envelopeSha256"`
	Tag         string `json:"tag"`
}
type receipt struct {
	Version          int    `json:"version"`
	Type             string `json:"type"`
	VM               string `json:"vmInstance"`
	Challenge        string `json:"challenge"`
	EnvelopeSHA      string `json:"envelopeSha256"`
	CheckpointDigest string `json:"checkpointDigest"`
	Status           string `json:"status"`
	Tag              string `json:"tag"`
}
type importer func(context.Context, []byte) error
type relay struct {
	cfg    config
	key    []byte
	run    importer
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
	used   bool
}

func validConfig(c config) bool {
	return hex64.MatchString(c.VMInstance) && targetName.MatchString(c.Target) && abs(c.Importer) && abs(c.Parent) && abs(c.ClaimDir)
}
func abs(s string) bool {
	return filepath.IsAbs(s) && filepath.Clean(s) == s && !strings.ContainsRune(s, 0)
}
func mac(key []byte, fields ...string) string {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(strings.Join(fields, "\x00")))
	return hex.EncodeToString(h.Sum(nil))
}
func digest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func readFrame(r io.Reader, limit uint32) ([]byte, error) {
	var h [4]byte
	if _, e := io.ReadFull(r, h[:]); e != nil {
		return nil, denied
	}
	n := binary.BigEndian.Uint32(h[:])
	if n == 0 || n > limit {
		return nil, denied
	}
	b := make([]byte, n)
	if _, e := io.ReadFull(r, b); e != nil {
		return nil, denied
	}
	return b, nil
}
func writeFrame(w io.Writer, v any) error {
	b, e := json.Marshal(v)
	if e != nil || len(b) > 2048 {
		return denied
	}
	var h [4]byte
	binary.BigEndian.PutUint32(h[:], uint32(len(b)))
	if _, e = w.Write(h[:]); e != nil {
		return e
	}
	_, e = w.Write(b)
	return e
}

// Reject duplicate object keys at every depth and trailing values before typed decoding.
func strict(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if err := value(d, 0); err != nil {
		return denied
	}
	if _, e := d.Token(); e != io.EOF {
		return denied
	}
	d = json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil {
		return denied
	}
	return nil
}
func value(d *json.Decoder, depth int) error {
	if depth > 64 {
		return denied
	}
	t, e := d.Token()
	if e != nil {
		return denied
	}
	if delim, ok := t.(json.Delim); ok {
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				k, e := d.Token()
				s, ok := k.(string)
				if e != nil || !ok || seen[s] {
					return denied
				}
				seen[s] = true
				if value(d, depth+1) != nil {
					return denied
				}
			}
			t, e = d.Token()
			if e != nil || t != json.Delim('}') {
				return denied
			}
		case '[':
			for d.More() {
				if value(d, depth+1) != nil {
					return denied
				}
			}
			t, e = d.Token()
			if e != nil || t != json.Delim(']') {
				return denied
			}
		default:
			return denied
		}
	}
	return nil
}
func newRelay(c config, key []byte, run importer) (*relay, error) {
	if !validConfig(c) || len(key) != 32 || run == nil {
		return nil, denied
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &relay{cfg: c, key: append([]byte(nil), key...), run: run, ctx: ctx, cancel: cancel}, nil
}
func (s *relay) revoke() { s.cancel() }
func (s *relay) claim() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.used || s.ctx.Err() != nil {
		return denied
	}
	s.used = true
	// Caller provisions private directory; claim is durable before dispatch.
	info, e := os.Lstat(s.cfg.ClaimDir)
	if e != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return denied
	}
	f, e := os.OpenFile(filepath.Join(s.cfg.ClaimDir, s.cfg.VMInstance), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return denied
	}
	_, e = f.WriteString("checkpoint-fixture-claimed-v1\n")
	if e == nil {
		e = f.Sync()
	}
	ce := f.Close()
	if e != nil || ce != nil {
		return denied
	}
	dir, e := os.Open(s.cfg.ClaimDir)
	if e != nil {
		return denied
	}
	defer dir.Close()
	if dir.Sync() != nil {
		return denied
	}
	return nil
}
func (s *relay) serve(conn net.Conn) {
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(60 * time.Second))
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-s.ctx.Done():
			conn.Close()
		case <-done:
		}
	}()
	if s.ctx.Err() != nil {
		return
	}
	var nonce [32]byte
	if _, e := rand.Read(nonce[:]); e != nil {
		return
	}
	challenge := hex.EncodeToString(nonce[:])
	if writeFrame(conn, map[string]any{"version": 1, "type": "challenge", "vmInstance": s.cfg.VMInstance, "challenge": challenge}) != nil {
		return
	}
	b, e := readFrame(conn, 2048)
	if e != nil {
		return
	}
	var a auth
	if strict(b, &a) != nil || a.Version != 1 || a.Type != "authenticate" || a.VM != s.cfg.VMInstance || a.Challenge != challenge || !hex64.MatchString(a.EnvelopeSHA) || !hex64.MatchString(a.Tag) {
		return
	}
	expected := mac(s.key, "turnlink-vm-checkpoint-auth-v1", a.VM, a.Challenge, a.EnvelopeSHA)
	if !hmac.Equal([]byte(a.Tag), []byte(expected)) {
		return
	}
	wire, e := readFrame(conn, maxEnvelope)
	if e != nil || digest(wire) != a.EnvelopeSHA {
		return
	}
	var envelope struct {
		Digest string `json:"digest"`
	} // Validate duplicate keys while allowing importer-owned fields.
	var generic map[string]any
	if strict(wire, &generic) != nil {
		return
	}
	d, ok := generic["digest"].(string)
	if !ok || !hex64.MatchString(d) {
		return
	}
	envelope.Digest = d
	if s.claim() != nil || s.ctx.Err() != nil {
		return
	}
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	// Any additional byte or EOF revokes this attempt; host must retain its write side.
	go func() { var extra [1]byte; conn.Read(extra[:]); cancel() }()
	if s.run(ctx, wire) != nil || ctx.Err() != nil {
		return
	}
	r := receipt{Version: 1, Type: "receipt", VM: a.VM, Challenge: challenge, EnvelopeSHA: a.EnvelopeSHA, CheckpointDigest: envelope.Digest, Status: "quarantined"}
	r.Tag = mac(s.key, "turnlink-vm-checkpoint-receipt-v1", r.VM, r.Challenge, r.EnvelopeSHA, r.CheckpointDigest, r.Status)
	writeFrame(conn, r)
}
func realImporter(c config) importer {
	return func(ctx context.Context, b []byte) error {
		cmd := exec.CommandContext(ctx, c.Importer, c.Parent, c.Target)
		cmd.Env = []string{"PATH=/usr/bin:/bin"}
		cmd.Stdin = bytes.NewReader(b)
		var out bytes.Buffer
		cmd.Stdout = &out
		cmd.Stderr = io.Discard
		if cmd.Run() != nil || out.Len() > 1024 {
			return denied
		}
		var result struct {
			Status         string `json:"status"`
			ReleaseAllowed bool   `json:"releaseAllowed"`
		}
		if strict(bytes.TrimSpace(out.Bytes()), &result) != nil || result.Status != "published_unverified" || result.ReleaseAllowed {
			return denied
		}
		return nil
	}
}
