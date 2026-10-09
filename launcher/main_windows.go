// Native Windows executable shim for VS Code's cliExecutable setting.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

type configuration struct {
	Node string `json:"node"`
	Root string `json:"root"`
	Codex string `json:"codex"`
	URL string `json:"url"`
	TokenFile string `json:"tokenFile"`
}

// JOBOBJECT_EXTENDED_LIMIT_INFORMATION, Windows x64 layout.
type limits struct {
	ProcessTime, JobTime int64
	Flags uint32
	MinWorkingSet, MaxWorkingSet uintptr
	ActiveProcessLimit uint32
	Affinity uintptr
	PriorityClass, SchedulingClass uint32
	IO [6]uint64
	ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory uintptr
}

func run() int {
	self, err := os.Executable()
	if err != nil { fmt.Fprintln(os.Stderr, err); return 1 }
	bytes, err := os.ReadFile(filepath.Join(filepath.Dir(self), "launcher.json"))
	if err != nil { fmt.Fprintln(os.Stderr, "agent-channel: launcher.json unavailable"); return 1 }
	var config configuration
	if err = json.Unmarshal(bytes, &config); err != nil { fmt.Fprintln(os.Stderr, "agent-channel: invalid launcher.json"); return 1 }
	for _, path := range []string{config.Node, config.Root, config.Codex, config.TokenFile} {
		if !filepath.IsAbs(path) { fmt.Fprintln(os.Stderr, "agent-channel: config paths must be absolute"); return 1 }
	}
	if same, _ := filepath.Abs(config.Codex); same == self { fmt.Fprintln(os.Stderr, "agent-channel: recursive Codex path"); return 1 }
	script := "codex-proxy.js"
	args := os.Args[1:]
	if len(args) > 0 && args[0] == "--channel-mcp" { script = "mcp.js"; args = args[1:] }
	if len(args) > 0 && args[0] == "--channel-session-hook" { script = "session-hook.js"; args = args[1:] }
	if len(args) > 0 && args[0] == "--channel-doctor" { script = "doctor.js"; args = args[1:] }
	args = append([]string{filepath.Join(config.Root, "src", script)}, args...)
	cmd := exec.Command(config.Node, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, "AGENT_CHANNEL_CODEX_EXECUTABLE="+config.Codex, "AGENT_CHANNEL_URL="+config.URL, "AGENT_CHANNEL_TOKEN_FILE="+config.TokenFile)
	// Children belong to a job so closing/killing this launcher terminates Node
	// and its real Codex child, rather than leaving a detached app-server.
	kernel := syscall.NewLazyDLL("kernel32.dll")
	create := kernel.NewProc("CreateJobObjectW")
	set := kernel.NewProc("SetInformationJobObject")
	assign := kernel.NewProc("AssignProcessToJobObject")
	job, _, jobErr := create.Call(0, 0)
	if job == 0 { fmt.Fprintln(os.Stderr, "agent-channel: cannot create child job:", jobErr); return 1 }
	defer syscall.CloseHandle(syscall.Handle(job))
	info := limits{Flags: 0x2000} // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if ok, _, _ := set.Call(job, 9, uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info)); ok == 0 {
		fmt.Fprintln(os.Stderr, "agent-channel: cannot configure child job"); return 1
	}
	// Attach the launcher before starting Node: every descendant inherits the job.
	current := kernel.NewProc("GetCurrentProcess")
	process, _, _ := current.Call()
	if ok, _, _ := assign.Call(job, process); ok == 0 {
		fmt.Fprintln(os.Stderr, "agent-channel: cannot attach child job"); return 1
	}
	err = cmd.Run()
	code := 0
	if err != nil {
		if exit, ok := err.(*exec.ExitError); ok { code = exit.ExitCode() } else { fmt.Fprintln(os.Stderr, "agent-channel: Node launch failed:", err); code = 1 }
	}
	// Do not close the job with the launcher still assigned: os.Exit closes all
	// handles with the chosen exit code and kills any remaining descendants.
	os.Exit(code)
	return code
}

func main() { os.Exit(run()) }
