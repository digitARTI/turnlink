import Foundation
import Virtualization

// Boots an ephemeral initramfs only: no network, guest disks or host mounts.
let config = VZVirtualMachineConfiguration()
let boot = VZLinuxBootLoader(kernelURL: URL(fileURLWithPath: CommandLine.arguments[1]))
boot.initialRamdiskURL = URL(fileURLWithPath: CommandLine.arguments[2])
boot.commandLine = "console=hvc0 panic=-1"
config.bootLoader = boot
config.cpuCount = 1
config.memorySize = CommandLine.arguments.count > 3 ? 2 * 1024 * 1024 * 1024 : 512 * 1024 * 1024
config.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
let pipe = Pipe()
let serial = VZVirtioConsoleDeviceSerialPortConfiguration()
serial.attachment = VZFileHandleSerialPortAttachment(fileHandleForReading: nil, fileHandleForWriting: pipe.fileHandleForWriting)
config.serialPorts = [serial]
do {
    try config.validate()
    print("configuration_valid=true"); fflush(stdout)
    let machine = VZVirtualMachine(configuration: config)
    var buffered = ""
    pipe.fileHandleForReading.readabilityHandler = { handle in
        let data = handle.availableData
        guard !data.isEmpty else { return }
        if let text = String(data: data, encoding: .utf8) {
            buffered += text
            if buffered.contains("TURNLINK_MINIMAL_GUEST_READY") {
                pipe.fileHandleForReading.readabilityHandler = nil
                print("guest=ready"); fflush(stdout)
                DispatchQueue.main.async { machine.stop { _ in exit(0) } }
            }
        }
    }
    machine.start { result in
        switch result {
        case .success: print("start=success"); fflush(stdout)
        case .failure(let error): print("start=failed \(error.localizedDescription)"); fflush(stdout); exit(1)
        }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
        print("guest=timeout"); print(buffered.suffix(3000)); fflush(stdout)
        machine.stop { _ in exit(2) }
    }
    dispatchMain()
} catch { print("configuration_valid=false \(error.localizedDescription)"); exit(1) }
