#import "../../../native/codex-vm-supervisor/broker-executable-check.h"
int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc != 5) return 2;
        return TurnlinkVerifyBrokerExecutable([NSString stringWithUTF8String:argv[1]], [NSString stringWithUTF8String:argv[2]],
                                               [NSString stringWithUTF8String:argv[3]], [NSString stringWithUTF8String:argv[4]]) ? 0 : 1;
    }
}
