// Linux-only review importer. It publishes a new quarantined Codex home, never
// merges a live store and never authorizes release. A trusted supervisor must
// authenticate its input and protect the parent directory before production.
package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

type reservation struct {
	Generation string `json:"generation"`
	Revision   uint64 `json:"revision"`
}
type checkpoint struct {
	Version        int             `json:"version"`
	ThreadID       string          `json:"threadId"`
	TransitionID   string          `json:"transitionId"`
	Reservation    reservation     `json:"reservation"`
	Digest         string          `json:"digest"`
	RolloutSHA     string          `json:"rolloutSha256"`
	JournalSHA     string          `json:"journalSha256"`
	RolloutBytes   int             `json:"rolloutBytes"`
	JournalBytes   int             `json:"journalBytes"`
	Rollout        []byte          `json:"rollout"`
	Journal        []byte          `json:"journal"`
	Config         []byte          `json:"config"`
	ConfigSHA      string          `json:"configSha256"`
	Grant          json.RawMessage `json:"grant"`
	ReleaseAllowed bool            `json:"releaseAllowed"`
}

var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var name = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`)

func hash(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }
func fail() error          { return errors.New("CHECKPOINT_IMPORT_UNAVAILABLE") }
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "checkpoint import unavailable")
		os.Exit(1)
	}
}

func run() error {
	if (len(os.Args) != 3 && (len(os.Args) != 4 || os.Args[3] != "--observe")) || !filepath.IsAbs(os.Args[1]) || filepath.Clean(os.Args[1]) != os.Args[1] || !name.MatchString(os.Args[2]) {
		return fail()
	}
	parent, err := filepath.EvalSymlinks(os.Args[1])
	if err != nil || parent != os.Args[1] {
		return fail()
	}
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || info.Mode()&0077 != 0 {
		return fail()
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Geteuid() {
		return fail()
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 6*1024*1024+1))
	if err != nil || len(raw) > 6*1024*1024 {
		return fail()
	}
	var c checkpoint
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&c) != nil || decoder.Decode(new(any)) != io.EOF {
		return fail()
	}
	if c.Version != 1 || c.ReleaseAllowed || !uuid.MatchString(c.ThreadID) || !uuid.MatchString(c.TransitionID) || !uuid.MatchString(c.Reservation.Generation) ||
		c.RolloutBytes != len(c.Rollout) || c.RolloutBytes == 0 || c.RolloutBytes > 4*1024*1024 || c.JournalBytes != len(c.Journal) || c.JournalBytes == 0 || c.JournalBytes > 64*1024 ||
		len(c.Config) == 0 || len(c.Config) > 256*1024 || hash(c.Config) != c.ConfigSHA || hash(c.Rollout) != c.RolloutSHA || hash(c.Journal) != c.JournalSHA {
		return fail()
	}
	expected := hash([]byte(fmt.Sprintf("%s:%s:%s:%d:%s:%s:%d", c.ThreadID, c.TransitionID, c.Reservation.Generation, c.Reservation.Revision, c.RolloutSHA, c.JournalSHA, c.RolloutBytes)))
	if expected != c.Digest {
		return fail()
	}
	var journal struct {
		ThreadID    string          `json:"thread_id"`
		Phase       string          `json:"phase"`
		Reservation reservation     `json:"reservation"`
		HostGrant   json.RawMessage `json:"host_grant"`
	}
	if json.Unmarshal(c.Journal, &journal) != nil || journal.ThreadID != c.ThreadID || journal.Phase != "grant_bound" || journal.Reservation != c.Reservation {
		return fail()
	}
	var grant, recorded map[string]any
	decodeGrant := func(raw []byte, output *map[string]any) error {
		d := json.NewDecoder(bytes.NewReader(raw))
		d.UseNumber()
		if err := d.Decode(output); err != nil {
			return err
		}
		if d.Decode(new(any)) != io.EOF {
			return fail()
		}
		return nil
	}
	if decodeGrant(c.Grant, &grant) != nil || decodeGrant(journal.HostGrant, &recorded) != nil || !reflect.DeepEqual(grant, recorded) ||
		grant["id"] != c.TransitionID || grant["agentId"] != "codex:"+c.ThreadID || grant["status"] != "prepared" || grant["checkpointConfigSha256"] != c.ConfigSHA {
		return fail()
	}
	scanner := bufio.NewScanner(bytes.NewReader(c.Rollout))
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	var first struct {
		Timestamp string `json:"timestamp"`
		Type      string `json:"type"`
		Payload   struct {
			ID string `json:"id"`
		} `json:"payload"`
	}
	if !scanner.Scan() || json.Unmarshal(scanner.Bytes(), &first) != nil || first.Type != "session_meta" || first.Payload.ID != c.ThreadID {
		return fail()
	}
	stamp, err := time.Parse(time.RFC3339Nano, first.Timestamp)
	if err != nil || stamp.Year() < 1970 || stamp.Year() > 9999 {
		return fail()
	}
	if !bytes.HasSuffix(c.Rollout, []byte("\n")) {
		return fail()
	}
	for scanner.Scan() {
		var line any
		if json.Unmarshal(scanner.Bytes(), &line) != nil {
			return fail()
		}
	}
	if scanner.Err() != nil {
		return fail()
	}
	filename := "rollout-" + stamp.Format("2006-01-02T15-04-05") + "-" + c.ThreadID + ".jsonl"
	if len(os.Args) == 4 {
		destination := filepath.Join(parent, os.Args[2])
		year := filepath.Join(destination, "sessions", stamp.Format("2006"))
		month := filepath.Join(year, stamp.Format("01"))
		day := filepath.Join(month, stamp.Format("02"))
		journalDir := filepath.Join(destination, "native-continuity")
		for _, item := range []struct {
			path  string
			names []string
		}{
			{destination, []string{"config.toml", "native-continuity", "sessions"}}, {filepath.Join(destination, "sessions"), []string{stamp.Format("2006")}},
			{year, []string{stamp.Format("01")}}, {month, []string{stamp.Format("02")}}, {day, []string{filename}}, {journalDir, []string{c.ThreadID + ".json"}},
		} {
			if checkDir(item.path, item.names) != nil {
				return fail()
			}
		}
		if checkFile(filepath.Join(day, filename), c.Rollout) != nil || checkFile(filepath.Join(journalDir, c.ThreadID+".json"), c.Journal) != nil || checkFile(filepath.Join(destination, "config.toml"), c.Config) != nil {
			return fail()
		}
		for _, dir := range []string{day, month, year, filepath.Join(destination, "sessions"), journalDir, destination, parent} {
			if syncDir(dir) != nil {
				return fail()
			}
		}
		fmt.Println(`{"status":"reconciled_unverified","releaseAllowed":false}`)
		return nil
	}
	stage, err := os.MkdirTemp(parent, ".turnlink-import-")
	if err != nil {
		return fail()
	}
	// Never remove a partial stage on error or crash: recovery can inspect it.
	sessionDir := filepath.Join(stage, "sessions", stamp.Format("2006"), stamp.Format("01"), stamp.Format("02"))
	journalDir := filepath.Join(stage, "native-continuity")
	if os.MkdirAll(sessionDir, 0700) != nil || os.Mkdir(journalDir, 0700) != nil {
		return fail()
	}
	if write(filepath.Join(sessionDir, filename), c.Rollout) != nil || write(filepath.Join(journalDir, c.ThreadID+".json"), c.Journal) != nil || write(filepath.Join(stage, "config.toml"), c.Config) != nil {
		return fail()
	}
	for _, dir := range []string{sessionDir, filepath.Dir(sessionDir), filepath.Dir(filepath.Dir(sessionDir)), filepath.Join(stage, "sessions"), journalDir, stage} {
		if syncDir(dir) != nil {
			return fail()
		}
	}
	if os.Getenv("TURNLINK_IMPORT_TEST_CRASH") == "before-rename" {
		os.Exit(91)
	}
	from, err := syscall.BytePtrFromString(stage)
	if err != nil {
		return fail()
	}
	to, err := syscall.BytePtrFromString(filepath.Join(parent, os.Args[2]))
	if err != nil {
		return fail()
	}
	at := int64(-100)
	_, _, errno := syscall.Syscall6(syscall.SYS_RENAMEAT2, uintptr(at), uintptr(unsafe.Pointer(from)), uintptr(at), uintptr(unsafe.Pointer(to)), 1, 0)
	if errno != 0 {
		return fail()
	}
	if os.Getenv("TURNLINK_IMPORT_TEST_CRASH") == "after-rename" {
		os.Exit(92)
	}
	if syncDir(parent) != nil {
		return fail()
	}
	fmt.Println(strings.TrimSpace(`{"status":"published_unverified","releaseAllowed":false}`))
	return nil
}
func checkDir(path string, expected []string) error {
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&0077 != 0 {
		return fail()
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Geteuid() {
		return fail()
	}
	entries, err := os.ReadDir(path)
	if err != nil || len(entries) != len(expected) {
		return fail()
	}
	for _, entry := range entries {
		found := false
		for _, name := range expected {
			if entry.Name() == name {
				found = true
			}
		}
		if !found {
			return fail()
		}
	}
	return nil
}
func checkFile(path string, expected []byte) error {
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return fail()
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode()&0077 != 0 || info.Size() != int64(len(expected)) {
		return fail()
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || int(stat.Uid) != os.Geteuid() {
		return fail()
	}
	contents, err := io.ReadAll(io.LimitReader(f, int64(len(expected))+1))
	if err != nil || !bytes.Equal(contents, expected) {
		return fail()
	}
	return f.Sync()
}
func write(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func syncDir(path string) error {
	d, err := os.Open(path)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}
