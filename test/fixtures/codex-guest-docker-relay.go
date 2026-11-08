package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
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

func readFull(fd int, data []byte) error {
	for len(data) > 0 {
		n, err := syscall.Read(fd, data)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.EOF
		}
		data = data[n:]
	}
	return nil
}
func writeFull(fd int, data []byte) error {
	for len(data) > 0 {
		n, err := syscall.Write(fd, data)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		data = data[n:]
	}
	return nil
}
func persistPending() error {
	f, err := os.OpenFile("/state/revoked.pending", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write([]byte("revoked\n")); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	d, err := os.Open("/state")
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
func persistRevocation() error {
	if prior, err := os.ReadFile("/state/revoked"); err == nil {
		if string(prior) != "revoked\n" {
			return errors.New("invalid revocation record")
		}
		f, err := os.Open("/state/revoked")
		if err != nil {
			return err
		}
		if err = f.Sync(); err != nil {
			f.Close()
			return err
		}
		f.Close()
		d, err := os.Open("/state")
		if err != nil {
			return err
		}
		defer d.Close()
		return d.Sync()
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := persistPending(); err != nil {
		return err
	}
	if err := os.Rename("/state/revoked.pending", "/state/revoked"); err != nil {
		return err
	}
	d, err := os.Open("/state")
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
func pingDocker() bool {
	c, err := net.DialTimeout("unix", "/run/docker.sock", 2*time.Second)
	if err != nil {
		return false
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := c.Write([]byte("GET /_ping HTTP/1.0\r\nHost: docker\r\n\r\n")); err != nil {
		return false
	}
	b := make([]byte, 512)
	n, err := c.Read(b)
	return (err == nil || err == io.EOF) && n >= 12 && string(b[:12]) == "HTTP/1.0 200"
}
func createContainer() bool {
	body := []byte(`{"Image":"alpine:3.21","Cmd":["true"],"HostConfig":{"NetworkMode":"none"}}`)
	c, err := net.DialTimeout("unix", "/run/docker.sock", 2*time.Second)
	if err != nil {
		return false
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	request := fmt.Sprintf("POST /containers/create?name=turnlink-guest-fixture HTTP/1.0\r\nHost: docker\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n", len(body))
	if _, err := c.Write(append([]byte(request), body...)); err != nil {
		return false
	}
	b := make([]byte, 512)
	n, err := c.Read(b)
	return (err == nil || err == io.EOF) && n >= 12 && string(b[:12]) == "HTTP/1.0 201"
}
func containerStatus() byte {
	c, err := net.DialTimeout("unix", "/run/docker.sock", 2*time.Second)
	if err != nil {
		return 'E'
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err := c.Write([]byte("GET /containers/turnlink-guest-fixture/json HTTP/1.0\r\nHost: docker\r\n\r\n")); err != nil {
		return 'E'
	}
	b := make([]byte, 512)
	n, err := c.Read(b)
	if (err != nil && err != io.EOF) || n < 12 {
		return 'E'
	}
	if string(b[:12]) == "HTTP/1.0 404" {
		return 'I'
	}
	if string(b[:12]) == "HTTP/1.0 200" {
		return 'Y'
	}
	return 'E'
}
func startDiskProbe() {
	f, err := os.OpenFile("/state/io-probe", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		fmt.Println("TURNLINK_IO_FAILED")
		return
	}
	defer f.Close()
	block := make([]byte, 1024*1024)
	for index := 0; index < 128; index++ {
		if _, err := f.Write(block); err != nil {
			fmt.Println("TURNLINK_IO_FAILED")
			return
		}
		if index == 0 {
			fmt.Println("TURNLINK_GUEST_INFLIGHT_PENDING")
		}
		time.Sleep(2 * time.Millisecond)
	}
	if f.Sync() != nil {
		fmt.Println("TURNLINK_IO_FAILED")
		return
	}
	fmt.Println("TURNLINK_IO_COMPLETE")
}
func main() {
	secret, err := os.ReadFile("/secret")
	if err != nil || len(secret) != 32 {
		panic("secret")
	}
	_, err = os.Stat("/state/revoked")
	revoked := err == nil
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		panic(err)
	}
	_, err = os.Stat("/state/revoked.pending")
	if err == nil {
		revoked = true
	} else if !errors.Is(err, os.ErrNotExist) {
		panic(err)
	}
	fd, err := syscall.Socket(40, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		panic(err)
	}
	address := sockaddrVM{Family: 40, Port: 4050, CID: ^uint32(0)}
	_, _, errno := syscall.Syscall(syscall.SYS_BIND, uintptr(fd), uintptr(unsafe.Pointer(&address)), unsafe.Sizeof(address))
	if errno != 0 {
		panic(errno)
	}
	if err = syscall.Listen(fd, 8); err != nil {
		panic(err)
	}
	var mutex, persistMutex sync.Mutex
	release := make(chan struct{})
	var releaseOnce sync.Once
	fmt.Println("TURNLINK_GUEST_SERVER_READY")
	for {
		raw, _, errno := syscall.Syscall6(syscall.SYS_ACCEPT4, uintptr(fd), 0, 0, 0, 0, 0)
		if errno != 0 {
			continue
		}
		go func(conn int) {
			defer syscall.Close(conn)
			nonce := make([]byte, 32)
			message := make([]byte, 33)
			if _, err := rand.Read(nonce); err != nil || writeFull(conn, nonce) != nil || readFull(conn, message) != nil {
				return
			}
			// Fixture-only bidirectional authentication. B/Y/Z map to the existing
			// read-only ping, revocation and inspection operations respectively.
			command := message[0]
			signedReply := command == 'B' || command == 'Y' || command == 'Z'
			var clientNonce [32]byte
			if signedReply && readFull(conn, clientNonce[:]) != nil { return }
			mac := hmac.New(sha256.New, secret)
			mac.Write(nonce)
			mac.Write(message[:1])
			if signedReply { mac.Write(clientNonce[:]) }
			valid := hmac.Equal(mac.Sum(nil), message[1:])
			if command == 'B' {
				message[0] = 'P'
			}
			if command == 'Y' {
				message[0] = 'R'
			}
			if command == 'Z' {
				message[0] = 'I'
			}
			answer := byte('N')
			if valid && message[0] == 'R' {
				mutex.Lock()
				revoked = true
				mutex.Unlock()
				persistMutex.Lock()
				if persistRevocation() == nil {
					answer = 'R'
				}
				persistMutex.Unlock()
			}
			// Test-only crash point after the pending record is durable but before rename.
			if valid && message[0] == 'X' {
				mutex.Lock()
				revoked = true
				mutex.Unlock()
				persistMutex.Lock()
				if persistPending() == nil {
					answer = 'X'
				}
				persistMutex.Unlock()
			}
			if valid && message[0] == 'U' {
				releaseOnce.Do(func() { close(release) })
				answer = 'U'
			}
			mutex.Lock()
			allowed := !revoked
			mutex.Unlock()
			if valid && message[0] == 'P' && allowed && pingDocker() {
				answer = 'P'
			}
			if valid && message[0] == 'C' && allowed && createContainer() {
				answer = 'C'
			}
			if valid && message[0] == 'I' {
				answer = containerStatus()
			}
			if valid && message[0] == 'J' {
				if info, err := os.Stat("/state/io-probe"); err == nil {
					if info.Size() < 128*1024*1024 {
						answer = 'J'
					} else {
						answer = 'K'
					}
				} else if errors.Is(err, os.ErrNotExist) {
					answer = 'M'
				} else {
					answer = 'E'
				}
			}
			if valid && message[0] == 'Q' {
				syscall.Sync()
				answer = 'Q'
			}
			// Deliberately unsafe fixture: pause after checking authority, before
			// sending the daemon request. Used only to reproduce the revocation gap.
			if valid && message[0] == 'W' && allowed {
				fmt.Println("TURNLINK_GUEST_UNSAFE_CHECK_PASSED")
				<-release
				if createContainer() {
					answer = 'C'
				}
			}
			// A pre-dispatch recheck handles a revocation observed while queued.
			// It is still not atomic with Docker's acceptance of the next request.
			if valid && message[0] == 'S' && allowed {
				fmt.Println("TURNLINK_GUEST_RECHECK_PENDING")
				<-release
				mutex.Lock()
				stillAllowed := !revoked
				mutex.Unlock()
				if stillAllowed && createContainer() {
					answer = 'C'
				}
			}
			// A VM pause probe: admit, wait, then submit to the guest-local daemon.
			if valid && message[0] == 'D' && allowed {
				fmt.Println("TURNLINK_GUEST_PAUSE_PENDING")
				time.Sleep(1500 * time.Millisecond)
				if createContainer() {
					answer = 'C'
				}
			}
			// The daemon has returned HTTP 201 before the host sees the marker.
			// Keep the host reply pending while a separate guest disk write starts.
			if valid && message[0] == 'F' && allowed && createContainer() {
				go startDiskProbe()
				<-release
				answer = 'C'
			}
			if signedReply && valid {
				mac = hmac.New(sha256.New, secret)
				mac.Write(nonce)
				mac.Write([]byte("guest"))
				mac.Write([]byte{command, answer})
				mac.Write(clientNonce[:])
				writeFull(conn, append([]byte{answer}, mac.Sum(nil)...))
			} else {
				writeFull(conn, []byte{answer})
			}
		}(int(raw))
	}
}
