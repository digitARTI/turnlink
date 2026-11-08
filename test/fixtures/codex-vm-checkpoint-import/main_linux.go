//go:build linux

package main

import (
	"io"
	"net"
	"os"
	"sync"
	"syscall"
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
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "fixture-private")
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		f.Close()
		return nil, denied
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != uint32(os.Geteuid()) || st.Nlink != 1 {
		f.Close()
		return nil, denied
	}
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
		panic("fixture requires config and key")
	}
	raw, err := boundedRead(os.Args[1], 8192)
	if err != nil {
		panic("config unavailable")
	}
	var c config
	if strict(raw, &c) != nil || !validConfig(c) {
		panic("invalid config")
	}
	key, err := boundedRead(os.Args[2], 32)
	if err != nil || len(key) != 32 {
		panic("key unavailable")
	}
	s, err := newRelay(c, key, realImporter(c))
	if err != nil {
		panic("relay unavailable")
	}
	defer s.revoke()
	fd, err := listen(4053)
	if err != nil {
		panic("vsock unavailable")
	}
	var once sync.Once
	stop := func() { once.Do(func() { closeListener(fd) }) }
	defer stop()
	var workers sync.WaitGroup
	defer workers.Wait()
	go func() { io.Copy(io.Discard, os.Stdin); s.revoke(); stop() }()
	for {
		conn, err := accept(fd)
		if err != nil {
			return
		}
		workers.Add(1)
		go func() { defer workers.Done(); s.serve(conn) }()
	}
}
