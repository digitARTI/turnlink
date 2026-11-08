import Foundation
import Virtualization
import Darwin

// Disposable guest fixture. Stdout/stdin carry only its vsock stream;
// diagnostics go to stderr. No host directory or network is attached.
let config = VZVirtualMachineConfiguration()
let boot = VZLinuxBootLoader(kernelURL: URL(fileURLWithPath: CommandLine.arguments[1]))
boot.initialRamdiskURL = URL(fileURLWithPath: CommandLine.arguments[2])
boot.commandLine = "console=hvc0 panic=-1"
config.bootLoader = boot; config.cpuCount = 1; config.memorySize = CommandLine.arguments.count > 3 ? 2 * 1024 * 1024 * 1024 : 512 * 1024 * 1024
config.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
config.socketDevices = [VZVirtioSocketDeviceConfiguration()]
let serialPipe = Pipe(), serial = VZVirtioConsoleDeviceSerialPortConfiguration()
serial.attachment = VZFileHandleSerialPortAttachment(fileHandleForReading: nil, fileHandleForWriting: serialPipe.fileHandleForWriting)
config.serialPorts = [serial]
do { try config.validate() } catch { exit(2) }
let vm = VZVirtualMachine(configuration: config)
var connection: VZVirtioSocketConnection?
var ending = false
func finish(_ status: Int32) {
    if ending { return }; ending = true
    if vm.canStop { vm.stop { _ in exit(status) } } else { exit(status) }
}
func connect(_ remaining: Int) {
    if remaining == 0 { finish(3); return }
    let device = vm.socketDevices[0] as! VZVirtioSocketDevice
    device.connect(toPort: 4055) { result in
        guard case .success(let peer) = result else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { connect(remaining - 1) }; return
        }
        connection = peer
        let fd = peer.fileDescriptor
        DispatchQueue.global().async {
            var bytes = [UInt8](repeating: 0, count: 4096)
            while true { let count = read(STDIN_FILENO, &bytes, bytes.count); if count <= 0 { shutdown(fd, SHUT_WR); return }
                var offset = 0; while offset < count { let wrote = bytes.withUnsafeBytes { write(fd, $0.baseAddress!.advanced(by: offset), count - offset) }; if wrote <= 0 { return }; offset += wrote } }
        }
        DispatchQueue.global().async {
            var bytes = [UInt8](repeating: 0, count: 4096)
            while true { let count = read(fd, &bytes, bytes.count); if count <= 0 { break }
                var offset = 0; while offset < count { let wrote = bytes.withUnsafeBytes { write(STDOUT_FILENO, $0.baseAddress!.advanced(by: offset), count - offset) }; if wrote <= 0 { break }; offset += wrote } }
            DispatchQueue.main.async { finish(0) }
        }
    }
}
serialPipe.fileHandleForReading.readabilityHandler = { handle in
    let data = handle.availableData; if !data.isEmpty { try? FileHandle.standardError.write(contentsOf: data) }
}
vm.start { result in
    switch result { case .success: connect(100); case .failure: finish(4) }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 40) { finish(5) }
dispatchMain()
