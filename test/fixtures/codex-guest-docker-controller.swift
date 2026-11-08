import Foundation
import Virtualization
import CryptoKit
import Darwin

let args = CommandLine.arguments
let key = try Data(contentsOf: URL(fileURLWithPath: args[4]))
let mode = args[5]
let config = VZVirtualMachineConfiguration()
let boot = VZLinuxBootLoader(kernelURL: URL(fileURLWithPath: args[1]))
boot.initialRamdiskURL = URL(fileURLWithPath: args[2])
boot.commandLine = "console=hvc0 panic=-1"
config.bootLoader = boot; config.cpuCount = 1; config.memorySize = 1024 * 1024 * 1024
config.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
config.socketDevices = [VZVirtioSocketDeviceConfiguration()]
let disk = try VZDiskImageStorageDeviceAttachment(url: URL(fileURLWithPath: args[3]), readOnly: false)
config.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment: disk)]
let pipe = Pipe(), serial = VZVirtioConsoleDeviceSerialPortConfiguration()
serial.attachment = VZFileHandleSerialPortAttachment(fileHandleForReading: nil, fileHandleForWriting: pipe.fileHandleForWriting)
config.serialPorts = [serial]
try config.validate()
let machine = VZVirtualMachine(configuration: config)
let socket = machine.socketDevices[0] as! VZVirtioSocketDevice
var buffer = "", started = false, raceControlStarted = false, raceRevoked = false
var pauseControlStarted = false, pauseConfirmed = false, resumedAfterPause = false, delayedFinished = false
func transfer(_ fd: Int32, _ data: inout [UInt8], _ writing: Bool) -> Bool {
    var offset = 0
    while offset < data.count {
        let remaining = data.count - offset
        let n = data.withUnsafeMutableBytes { ptr in
            writing ? Darwin.write(fd, ptr.baseAddress!.advanced(by: offset), remaining) : Darwin.read(fd, ptr.baseAddress!.advanced(by: offset), remaining)
        }
        if n <= 0 { return false }; offset += n
    }
    return true
}
func request(_ command: UInt8, valid: Bool, done: @escaping (UInt8) -> Void) {
    socket.connect(toPort: 4050) { result in
        switch result {
        case .failure(let error): print("connect_failed=\(error.localizedDescription)"); exit(1)
        case .success(let connection):
            DispatchQueue.global().async { [connection] in
                let fd = connection.fileDescriptor
                var timeout = timeval(tv_sec: 5, tv_usec: 0)
                setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
                var nonce = [UInt8](repeating: 0, count: 32)
                guard transfer(fd, &nonce, false) else { print("read_nonce_failed"); exit(1) }
                let secret = valid ? key : Data(repeating: 0, count: 32)
                let message = Data(nonce) + Data([command])
                let code = HMAC<SHA256>.authenticationCode(for: message, using: SymmetricKey(data: secret))
                var frame = [command] + Array(code)
                guard transfer(fd, &frame, true) else { print("write_failed"); exit(1) }
                var answer = [UInt8](repeating: 0, count: 1)
                guard transfer(fd, &answer, false) else {
                    if (mode == "pause-stop" || mode == "pause-inflight") && pauseConfirmed { return }
                    print("read_answer_failed"); exit(1)
                }
                DispatchQueue.main.async { done(answer[0]) }
            }
        }
    }
}
func fail(_ reason: String) -> Never { print(reason); fflush(stdout); exit(1) }
func runProbe() {
    if mode == "create-sync-stop" {
        request(67, valid: true) { created in
            guard created == 67 else { fail("docker_create_failed") }
            request(81, valid: true) { synced in
                guard synced == 81 else { fail("guest_sync_failed") }
                print("docker_create_and_guest_sync=true"); fflush(stdout); machine.stop { _ in exit(0) }
            }
        }
        return
    }
    if mode == "inspect" || mode == "inspect-present" {
        request(80, valid: true) { ping in
            guard ping == 80 else { fail("inspection_ping_failed") }
            request(73, valid: true) { answer in
                guard answer == 73 || answer == 89 else { fail("container_state_unverified_code=\(answer)") }
                if mode == "inspect" && answer != 73 { fail("pending_create_found") }
                if mode == "inspect" { print("reconstructed_daemon_container_absent=true"); fflush(stdout); machine.stop { _ in exit(0) } }
                else {
                    request(74, valid: true) { io in
                        let state = io == 74 ? "partial" : io == 75 ? "complete" : io == 77 ? "missing" : "unverified"
                        print("reconstructed_daemon_container_present=\(answer == 89) io_state=\(state)"); fflush(stdout); machine.stop { _ in exit(0) }
                    }
                }
            }
        }
        return
    }
    if mode == "pause" || mode == "pause-stop" || mode == "pause-inflight" {
        request(mode == "pause-inflight" ? 70 : 68, valid: true) { answer in
            delayedFinished = true
            guard pauseConfirmed && resumedAfterPause && answer == 67 else { fail("pause_effect_order_invalid") }
            print("pause_confirmed=true effect_during_pause=false effect_after_resume=true")
            fflush(stdout); machine.stop { _ in exit(0) }
        }
        return
    }
    if mode == "race" || mode == "recheck" {
        request(mode == "race" ? 87 : 83, valid: true) { answer in
            guard raceRevoked && answer == (mode == "race" ? 67 : 78) else { fail("race_not_reproduced") }
            print(mode == "race" ? "revoked_before_daemon_create=true" : "recheck_blocked_daemon_create=true")
            fflush(stdout); machine.stop { _ in exit(0) }
        }
        return
    }
    if mode == "pending-crash" {
        request(88, valid: true) { answer in
            guard answer == 88 else { fail("pending_record_failed") }
            print("pending_record_durable=true crash_before_rename=true")
            fflush(stdout); kill(getpid(), SIGKILL)
        }
        return
    }
    if mode == "recover" {
        request(67, valid: true) { answer in
            guard answer == 78 else { fail("recovery_revocation_failed") }
            print("recovery_denied=true"); fflush(stdout); machine.stop { _ in exit(0) }
        }
        return
    }
    request(67, valid: false) { bad in
        guard bad == 78 else { fail("unauthorized_not_denied") }
        request(80, valid: true) { ping in
            guard ping == 80 else { fail("docker_ping_failed") }
            request(67, valid: true) { created in
                guard created == 67 else { fail("docker_create_failed") }
                request(82, valid: true) { revoked in
                    guard revoked == 82 else { fail("revoke_failed") }
                    request(67, valid: true) { denied in
                        guard denied == 78 else { fail("post_revoke_not_denied") }
                        print("bad_hmac_denied=true docker_ping=true docker_create=true revoke_durable=true post_revoke_denied=true")
                        fflush(stdout); kill(getpid(), SIGKILL)
                    }
                }
            }
        }
    }
}
pipe.fileHandleForReading.readabilityHandler = { handle in
    let data = handle.availableData
    if let text = String(data: data, encoding: .utf8) {
        buffer += text
        if buffer.contains("TURNLINK_GUEST_SERVER_READY") && !started {
            started = true; DispatchQueue.main.async { runProbe() }
        }
        if (buffer.contains("TURNLINK_GUEST_UNSAFE_CHECK_PASSED") || buffer.contains("TURNLINK_GUEST_RECHECK_PENDING")) && !raceControlStarted {
            raceControlStarted = true
            DispatchQueue.main.async {
                request(82, valid: true) { answer in
                    guard answer == 82 else { fail("race_revoke_failed") }; raceRevoked = true
                    request(85, valid: true) { answer in if answer != 85 { fail("race_release_failed") } }
                }
            }
        }
        if (buffer.contains("TURNLINK_GUEST_PAUSE_PENDING") || buffer.contains("TURNLINK_GUEST_INFLIGHT_PENDING")) && !pauseControlStarted {
            pauseControlStarted = true
            DispatchQueue.main.async {
                let requested = DispatchTime.now().uptimeNanoseconds
                machine.pause { result in
                    if case .failure(let error) = result { fail("pause_failed=\(error.localizedDescription)") }
                    guard machine.state == .paused && !delayedFinished else { fail("pause_not_confirmed") }
                    pauseConfirmed = true
                    let elapsed = Double(DispatchTime.now().uptimeNanoseconds - requested) / 1_000_000
                    print(String(format: "pause_callback_ms=%.3f", elapsed)); fflush(stdout)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                        guard machine.state == .paused && !delayedFinished else { fail("effect_during_pause") }
                        if mode == "pause-stop" || mode == "pause-inflight" {
                            machine.stop { result in
                                if let error = result { fail("stop_failed=\(error.localizedDescription)") }
                                print(mode == "pause-inflight" ? "daemon_accepted_before_pause=true io_started=true pause_confirmed=true stopped_without_resume=true" : "pause_confirmed=true effect_during_pause=false stopped_without_resume=true"); fflush(stdout); exit(0)
                            }
                            return
                        }
                        machine.resume { result in
                            if case .failure(let error) = result { fail("resume_failed=\(error.localizedDescription)") }
                            resumedAfterPause = true
                        }
                    }
                }
            }
        }
        if buffer.contains("TURNLINK_GUEST_DAEMON_FAILED") { print(buffer.suffix(4000)); fflush(stdout); exit(1) }
    }
}
machine.start { result in if case .failure(let error) = result { fail("start_failed=\(error.localizedDescription)") } }
DispatchQueue.main.asyncAfter(deadline: .now() + 50) { print("timeout"); print(buffer.suffix(3000)); fflush(stdout); exit(2) }
dispatchMain()
