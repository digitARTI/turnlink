package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func fixture(t *testing.T, run importer) (*relay, []byte) {
	t.Helper()
	d := t.TempDir()
	if err := os.Chmod(d, 0700); err != nil {
		t.Fatal(err)
	}
	key := bytes.Repeat([]byte{3}, 32)
	s, e := newRelay(config{VMInstance: strings.Repeat("a", 64), Importer: "/importer", Parent: "/stage", Target: "candidate", ClaimDir: d}, key, run)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(s.revoke)
	return s, key
}
func request(t *testing.T, s *relay, key []byte, wire []byte, mutate func(*auth)) (receipt, error) {
	t.Helper()
	client, server := net.Pipe()
	defer client.Close()
	go s.serve(server)
	client.SetDeadline(time.Now().Add(time.Second))
	b, e := readFrame(client, 2048)
	if e != nil {
		return receipt{}, e
	}
	var ch struct {
		VM        string `json:"vmInstance"`
		Challenge string `json:"challenge"`
	}
	if json.Unmarshal(b, &ch) != nil {
		t.Fatal("challenge")
	}
	a := auth{Version: 1, Type: "authenticate", VM: ch.VM, Challenge: ch.Challenge, EnvelopeSHA: digest(wire)}
	a.Tag = mac(key, "turnlink-vm-checkpoint-auth-v1", a.VM, a.Challenge, a.EnvelopeSHA)
	if mutate != nil {
		mutate(&a)
	}
	if e = writeFrame(client, a); e != nil {
		return receipt{}, e
	}
	var hdr [4]byte
	n := len(wire)
	hdr[0] = byte(n >> 24)
	hdr[1] = byte(n >> 16)
	hdr[2] = byte(n >> 8)
	hdr[3] = byte(n)
	if _, e = client.Write(hdr[:]); e != nil {
		return receipt{}, e
	}
	if _, e = client.Write(wire); e != nil {
		return receipt{}, e
	}
	b, e = readFrame(client, 2048)
	if e != nil {
		return receipt{}, e
	}
	var result receipt
	if json.Unmarshal(b, &result) != nil {
		t.Fatal("receipt")
	}
	return result, nil
}
func TestReceiptAndReplay(t *testing.T) {
	var calls atomic.Int32
	s, key := fixture(t, func(_ context.Context, b []byte) error { calls.Add(1); return nil })
	wire := []byte(`{"digest":"` + strings.Repeat("b", 64) + `","config":"secret"}`)
	r, e := request(t, s, key, wire, nil)
	if e != nil || r.Status != "quarantined" || r.CheckpointDigest != strings.Repeat("b", 64) || r.Tag != mac(key, "turnlink-vm-checkpoint-receipt-v1", r.VM, r.Challenge, r.EnvelopeSHA, r.CheckpointDigest, r.Status) {
		t.Fatalf("invalid receipt: %v", e)
	}
	if _, e = request(t, s, key, wire, nil); e == nil || calls.Load() != 1 {
		t.Fatal("replay accepted")
	}
	s2, _ := newRelay(s.cfg, key, s.run)
	defer s2.revoke()
	if _, e = request(t, s2, key, wire, nil); e == nil || calls.Load() != 1 {
		t.Fatal("restart replay accepted")
	}
}
func TestMismatchAndDuplicates(t *testing.T) {
	for _, tc := range []string{"vm", "tag", "duplicate"} {
		t.Run(tc, func(t *testing.T) {
			var calls atomic.Int32
			s, key := fixture(t, func(context.Context, []byte) error { calls.Add(1); return nil })
			wire := []byte(`{"digest":"` + strings.Repeat("b", 64) + `"}`)
			if tc == "duplicate" {
				wire = []byte(`{"digest":"` + strings.Repeat("b", 64) + `","digest":"` + strings.Repeat("c", 64) + `"}`)
			}
			_, e := request(t, s, key, wire, func(a *auth) {
				if tc == "vm" {
					a.VM = strings.Repeat("c", 64)
				}
				if tc == "tag" {
					a.Tag = strings.Repeat("0", 64)
				}
			})
			if e == nil || calls.Load() != 0 {
				t.Fatal("invalid request accepted")
			}
		})
	}
}
func TestRevocationDuringImport(t *testing.T) {
	started := make(chan struct{})
	s, key := fixture(t, func(ctx context.Context, _ []byte) error { close(started); <-ctx.Done(); return ctx.Err() })
	wire := []byte(`{"digest":"` + strings.Repeat("b", 64) + `"}`)
	done := make(chan error, 1)
	go func() { _, e := request(t, s, key, wire, nil); done <- e }()
	<-started
	s.revoke()
	if e := <-done; e == nil {
		t.Fatal("receipt after revoke")
	}
	if _, e := request(t, s, key, wire, nil); e == nil {
		t.Fatal("revoked relay accepted")
	}
}
func TestFrameBounds(t *testing.T) {
	if _, e := readFrame(bytes.NewReader([]byte{0, 0x60, 0, 1}), maxEnvelope); e == nil {
		t.Fatal("oversize accepted")
	}
	if _, e := readFrame(bytes.NewReader([]byte{0, 0, 0, 5, 1}), maxEnvelope); e == nil {
		t.Fatal("truncated accepted")
	}
	if strict([]byte(`{"a":{"b":1,"b":2}}`), &map[string]any{}) == nil {
		t.Fatal("nested duplicate")
	}
	_ = io.EOF
}

func TestSocketLossCancelsImporter(t *testing.T) {
	for _, extra := range []bool{false, true} {
		t.Run(map[bool]string{false: "eof", true: "extra"}[extra], func(t *testing.T) {
			started := make(chan struct{})
			stopped := make(chan struct{})
			s, key := fixture(t, func(ctx context.Context, _ []byte) error {
				close(started)
				<-ctx.Done()
				close(stopped)
				return ctx.Err()
			})
			client, server := net.Pipe()
			go s.serve(server)
			client.SetDeadline(time.Now().Add(2 * time.Second))
			b, e := readFrame(client, 2048)
			if e != nil {
				t.Fatal(e)
			}
			var ch struct {
				VM        string `json:"vmInstance"`
				Challenge string `json:"challenge"`
			}
			json.Unmarshal(b, &ch)
			wire := []byte(`{"digest":"` + strings.Repeat("b", 64) + `"}`)
			a := auth{Version: 1, Type: "authenticate", VM: ch.VM, Challenge: ch.Challenge, EnvelopeSHA: digest(wire)}
			a.Tag = mac(key, "turnlink-vm-checkpoint-auth-v1", a.VM, a.Challenge, a.EnvelopeSHA)
			if writeFrame(client, a) != nil {
				t.Fatal("auth")
			}
			var h [4]byte
			binary.BigEndian.PutUint32(h[:], uint32(len(wire)))
			if _, e = client.Write(h[:]); e != nil {
				t.Fatal(e)
			}
			if _, e = client.Write(wire); e != nil {
				t.Fatal(e)
			}
			<-started
			if extra {
				client.Write([]byte{1})
			} else {
				client.Close()
			}
			select {
			case <-stopped:
			case <-time.After(time.Second):
				t.Fatal("import not cancelled")
			}
			client.Close()
		})
	}
}
