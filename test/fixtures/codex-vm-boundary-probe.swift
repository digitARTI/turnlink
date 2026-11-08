import Foundation
import Virtualization

// Diskless, networkless EFI probe only. It has no guest OS or Docker daemon.
let config = VZVirtualMachineConfiguration()
config.cpuCount = 1
config.memorySize = 512 * 1024 * 1024
do {
    let boot = VZEFIBootLoader()
    boot.variableStore = try VZEFIVariableStore(creatingVariableStoreAt: URL(fileURLWithPath: CommandLine.arguments[1]))
    config.bootLoader = boot
    try config.validate()
    print("configuration_valid=true")
    fflush(stdout)
    let machine = VZVirtualMachine(configuration: config)
    machine.start { result in
        switch result {
        case .success:
            print("start=success")
            fflush(stdout)
            machine.stop { _ in exit(0) }
        case .failure(let error):
            print("start=failed domain=\((error as NSError).domain) code=\((error as NSError).code) description=\(error.localizedDescription)")
            fflush(stdout)
            exit(1)
        }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 5) { print("start=timeout"); fflush(stdout); exit(2) }
    dispatchMain()
} catch {
    print("configuration_valid=false domain=\((error as NSError).domain) code=\((error as NSError).code) description=\(error.localizedDescription)")
    exit(1)
}
