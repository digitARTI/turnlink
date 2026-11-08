// Linux fixture: one vsock peer performs the grant-scoped challenge and one
// synthetic attempt. The fixed key is public test data, not production auth.
package main

import (
	"bufio"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"syscall"
	"time"
	"unsafe"
)

type sockaddrVM struct {
	Family   uint16
	Reserved uint16
	Port     uint32
	CID      uint32
	Flags    uint8
	Zero     [3]byte
}
type frame struct {
	Version   int    `json:"version"`
	Type      string `json:"type"`
	Scope     string `json:"scope"`
	Challenge string `json:"challenge"`
	Tag       string `json:"tag"`
	Sequence  int    `json:"sequence"`
	Status    string `json:"status"`
}

func tag(key []byte, label, scope, challenge string) string {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(label + "\x00" + scope + "\x00" + challenge))
	return hex.EncodeToString(h.Sum(nil))
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "guest capability unavailable: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("TURNLINK_VM_ATTEMPT_OK")
}
func run() error {
	fd, err := syscall.Socket(40, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		return err
	}
	defer syscall.Close(fd)
	address := sockaddrVM{Family: 40, Port: 4055, CID: ^uint32(0)}
	if _, _, e := syscall.Syscall(syscall.SYS_BIND, uintptr(fd), uintptr(unsafe.Pointer(&address)), unsafe.Sizeof(address)); e != 0 {
		return e
	}
	if err = syscall.Listen(fd, 1); err != nil {
		return err
	}
	raw, _, errno := syscall.Syscall6(syscall.SYS_ACCEPT4, uintptr(fd), 0, 0, uintptr(syscall.SOCK_CLOEXEC), 0, 0)
	if errno != 0 {
		return errno
	}
	connected := int(raw)
	file := os.NewFile(uintptr(connected), "vsock")
	defer file.Close()
	timeout := syscall.Timeval{Sec: 20}
	syscall.SetsockoptTimeval(connected, syscall.SOL_SOCKET, syscall.SO_RCVTIMEO, &timeout)
	syscall.SetsockoptTimeval(connected, syscall.SOL_SOCKET, syscall.SO_SNDTIMEO, &timeout)
	reader := bufio.NewReaderSize(file, 1024)
	read := func(out *frame) error {
		b, err := reader.ReadBytes('\n')
		if err != nil {
			return err
		}
		if len(b) > 1024 {
			return fmt.Errorf("frame")
		}
		return json.Unmarshal(b, out)
	}
	send := func(v any) error { return json.NewEncoder(file).Encode(v) }
	var challenge frame
	if err = read(&challenge); err != nil || challenge.Version != 1 || challenge.Type != "challenge" || len(challenge.Scope) != 64 || len(challenge.Challenge) != 64 {
		return fmt.Errorf("challenge")
	}
	key := make([]byte, 32)
	for i := range key {
		key[i] = 0x22
	}
	if err = send(map[string]any{"version": 1, "type": "authenticate", "scope": challenge.Scope, "tag": tag(key, "turnlink-vm-attempt-v1", challenge.Scope, challenge.Challenge)}); err != nil {
		return err
	}
	var ready frame
	if err = read(&ready); err != nil || ready.Version != 1 || ready.Type != "ready" || ready.Scope != challenge.Scope || !hmac.Equal([]byte(ready.Tag), []byte(tag(key, "turnlink-vm-attempt-ready-v1", challenge.Scope, challenge.Challenge))) {
		return fmt.Errorf("ready")
	}
	if os.Getenv("TURNLINK_GUEST_NATIVE") == "1" {
		return nativeAttempt(file, challenge.Scope)
	}
	if err = send(map[string]any{"version": 1, "scope": challenge.Scope, "sequence": 1, "toolSha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}); err != nil {
		return err
	}
	var ack frame
	if err = read(&ack); err != nil || ack.Version != 1 || ack.Scope != challenge.Scope || ack.Sequence != 1 || ack.Status != "recorded" {
		return fmt.Errorf("ack")
	}
	time.Sleep(2 * time.Second)
	return nil
}

// Runs the real app-server inside the guest with the authenticated stream at
// fd 4. Only synthetic guest-local configuration and MCP server are used.
func nativeAttempt(channel *os.File, scope string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	controlPair, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		return err
	}
	controlRead := os.NewFile(uintptr(controlPair[0]), "control-child")
	controlWrite := os.NewFile(uintptr(controlPair[1]), "control-parent")
	defer controlRead.Close()
	defer controlWrite.Close()
	journalPair, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		return err
	}
	journalChild := os.NewFile(uintptr(journalPair[0]), "journal-child")
	journalRelay := os.NewFile(uintptr(journalPair[1]), "journal-relay")
	defer journalChild.Close()
	defer journalRelay.Close()
	cmd := exec.CommandContext(ctx, "/codex-app-server", "--native-continuity-control-fd", "3")
	cmd.Env = []string{"PATH=/bin", "HOME=/tmp", "CODEX_HOME=/tmp/codex", "CODEX_SQLITE_HOME=/tmp/sqlite", "TMPDIR=/tmp", "TURNLINK_FIXTURE_KEY=fixture", "TURNLINK_EXPERIMENTAL_MCP_OWNER_FD=4", "TURNLINK_EXPERIMENTAL_MCP_SCOPE=" + scope}
	cmd.ExtraFiles = []*os.File{controlRead, journalChild}
	cmd.Stderr = os.Stderr
	input, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err = cmd.Start(); err != nil {
		return err
	}
	journalChild.Close()
	go func() { io.Copy(channel, journalRelay); channel.Close() }()
	go func() { io.Copy(journalRelay, channel); journalRelay.Close() }()
	defer func() { cmd.Process.Kill(); cmd.Wait() }()
	encoder := json.NewEncoder(input)
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	rpc := func(id int, method string, params any) (map[string]any, error) {
		if err := encoder.Encode(map[string]any{"id": id, "method": method, "params": params}); err != nil {
			return nil, err
		}
		for scanner.Scan() {
			var message map[string]any
			if json.Unmarshal(scanner.Bytes(), &message) != nil {
				return nil, fmt.Errorf("rpc decode")
			}
			if message["id"] == float64(id) {
				if message["error"] != nil {
					return nil, fmt.Errorf("rpc refused: %v", message["error"])
				}
				result, ok := message["result"].(map[string]any)
				if !ok {
					return nil, fmt.Errorf("rpc result")
				}
				return result, nil
			}
		}
		return nil, fmt.Errorf("rpc closed")
	}
	if _, err = rpc(1, "initialize", map[string]any{"clientInfo": map[string]any{"name": "vm-fixture", "version": "1"}, "capabilities": map[string]any{"experimentalApi": true}}); err != nil {
		return fmt.Errorf("initialize: %w", err)
	}
	if err = encoder.Encode(map[string]any{"method": "initialized", "params": map[string]any{}}); err != nil {
		return err
	}
	started, err := rpc(2, "thread/start", map[string]any{"cwd": "/tmp", "sandbox": "read-only", "approvalPolicy": "on-request"})
	if err != nil {
		return fmt.Errorf("thread start: %w", err)
	}
	thread, ok := started["thread"].(map[string]any)
	if !ok {
		return fmt.Errorf("thread")
	}
	id, ok := thread["id"].(string)
	if !ok {
		return fmt.Errorf("thread id")
	}
	result, err := rpc(3, "mcpServer/tool/call", map[string]any{"threadId": id, "server": "fixture", "tool": "fixture_echo", "arguments": map[string]any{}})
	if err != nil {
		return fmt.Errorf("tool call: %w", err)
	}
	content, ok := result["content"].([]any)
	if !ok || len(content) != 1 {
		return fmt.Errorf("content")
	}
	item, ok := content[0].(map[string]any)
	if !ok || item["text"] != "ok" {
		return fmt.Errorf("content value")
	}
	fmt.Println("TURNLINK_VM_NATIVE_ATTEMPT_OK")
	time.Sleep(2 * time.Second)
	return nil
}
