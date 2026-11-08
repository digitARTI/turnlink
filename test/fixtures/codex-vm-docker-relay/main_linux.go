//go:build linux

package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sync"
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
type vsockAddr struct{}

func (vsockAddr) Network() string { return "vsock" }
func (vsockAddr) String() string  { return "fixture" }

type vsockConn struct{ *os.File }

func (c vsockConn) LocalAddr() net.Addr  { return vsockAddr{} }
func (c vsockConn) RemoteAddr() net.Addr { return vsockAddr{} }
func (c vsockConn) CloseWrite() error    { return syscall.Shutdown(int(c.Fd()), syscall.SHUT_WR) }
func boundedRead(path string, limit int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, denied
	}
	return b, nil
}

func listen(port uint32) (int, error) {
	fd, err := syscall.Socket(40, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		return -1, err
	}
	address := sockaddrVM{Family: 40, Port: port, CID: ^uint32(0)}
	_, _, errno := syscall.Syscall(syscall.SYS_BIND, uintptr(fd), uintptr(unsafe.Pointer(&address)), unsafe.Sizeof(address))
	if errno != 0 {
		syscall.Close(fd)
		return -1, errno
	}
	if err = syscall.Listen(fd, 16); err != nil {
		syscall.Close(fd)
		return -1, err
	}
	return fd, nil
}
func accept(fd int) (net.Conn, error) {
	raw, _, errno := syscall.Syscall6(syscall.SYS_ACCEPT4, uintptr(fd), 0, 0, uintptr(syscall.SOCK_CLOEXEC), 0, 0)
	if errno != 0 {
		return nil, errno
	}
	file := os.NewFile(raw, "fixture-vsock")
	if file == nil {
		syscall.Close(int(raw))
		return nil, denied
	}
	return vsockConn{file}, nil
}
func closeListener(fd int) { syscall.Shutdown(fd, syscall.SHUT_RDWR); syscall.Close(fd) }

func main() {
	if len(os.Args) != 3 {
		panic("fixture requires config and key paths")
	}
	raw, err := boundedRead(os.Args[1], 8192)
	if err != nil {
		panic("fixture configuration unavailable")
	}
	value, err := strictJSON(raw)
	object, ok := value.(map[string]any)
	if err != nil || !ok || !keys(object, "scope", "grantScope", "image", "name", "sessionId", "directory") {
		panic("fixture configuration invalid")
	}
	get := func(k string) string { s, _ := object[k].(string); return s }
	c := config{Scope: get("scope"), GrantScope: get("grantScope"), Image: get("image"), Name: get("name"), SessionID: get("sessionId"), Directory: get("directory")}
	key, err := boundedRead(os.Args[2], 32)
	if err != nil || len(key) != 32 || !c.valid() {
		panic("fixture authority unavailable")
	}
	if claimLease("/state/turnlink-docker-leases", c) != nil {
		panic("fixture lease unavailable")
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		var d net.Dialer
		d.Timeout = 3 * time.Second
		return d.DialContext(ctx, "unix", "/run/docker.sock")
	}, DisableCompression: true}
	server, err := newRelay(c, key, transport)
	if err != nil {
		panic("fixture relay unavailable")
	}
	time.AfterFunc(5*time.Minute, server.revoke)
	controlFD, err := listen(4052)
	if err != nil {
		panic("fixture lease vsock unavailable")
	}
	var closeControl sync.Once
	stopControl := func() { closeControl.Do(func() { closeListener(controlFD) }) }
	go func() { <-server.ctx.Done(); stopControl() }()
	fmt.Println("TURNLINK_DOCKER_LEASE_LISTENING")
	control, err := accept(controlFD)
	if err != nil {
		return
	}
	if server.holdLease(control) != nil {
		return
	}
	stopControl()
	if server.ctx.Err() != nil {
		return
	}
	fd, err := listen(4051)
	if err != nil {
		server.revoke()
		panic("fixture data vsock unavailable")
	}
	go func() { <-server.ctx.Done(); closeListener(fd) }()
	fmt.Println("TURNLINK_DOCKER_RELAY_READY")
	for {
		conn, err := accept(fd)
		if err != nil {
			if server.ctx.Err() != nil {
				return
			}
			continue
		}
		go server.serve(conn)
	}
}
