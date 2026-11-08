#import "protocol.h"
#include <stdio.h>
int main(int argc, const char **argv) {
    if (argc != 3) return 2;
    @autoreleasepool {
        NSString *mode = [NSString stringWithUTF8String:argv[1]];
        NSString *dir = [NSString stringWithUTF8String:argv[2]];
        NSXPCConnection *conn = [[NSXPCConnection alloc] initWithServiceName:@"org.turnlink.vmfixture.service"];
        conn.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkVMFixture)];
        [conn resume];
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block int result = 1;
        id<TurnlinkVMFixture> proxy = [conn remoteObjectProxyWithErrorHandler:^(NSError *error) {
            fprintf(stderr, "xpc-error: %s\n", error.description.UTF8String); puts("xpc-error"); fflush(stdout); dispatch_semaphore_signal(done);
        }];
        void (^reply)(NSString *) = ^(NSString *value) {
            printf("%s\n", value.UTF8String); fflush(stdout); result = 0; dispatch_semaphore_signal(done);
        };
        if ([mode isEqualToString:@"state"]) [proxy stateAt:dir reply:reply];
        else [proxy revokeAt:dir crashBeforeCommit:[mode isEqualToString:@"crash"] reply:reply];
        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC))) puts("timeout");
        [conn invalidate];
        return result;
    }
}
