#import "protocol.h"
#include <stdio.h>
#include <stdlib.h>
#include <libproc.h>
int main(void) {
    @autoreleasepool {
        NSXPCConnection *connection = [[NSXPCConnection alloc] initWithServiceName:@"org.turnlink.gate2probe.service"];
        connection.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(Gate2Probe)];
        [connection resume];
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        id<Gate2Probe> proxy = [connection remoteObjectProxyWithErrorHandler:^(NSError *error) {
            fprintf(stderr, "xpc error: %s\n", error.description.UTF8String);
            dispatch_semaphore_signal(done);
        }];
        [proxy start:^(int service, int child, uint64_t service_group, uint64_t child_group) {
            uint64_t client_group[5] = {0};
            int n = proc_pidinfo(getpid(), 20, 0, client_group, sizeof(client_group));
            printf("service=%d child=%d groups=%llu,%llu,%llu\n", service, child,
                   (unsigned long long)(n == sizeof(client_group) ? client_group[0] : 0),
                   (unsigned long long)service_group, (unsigned long long)child_group);
            fflush(stdout);
            dispatch_semaphore_signal(done);
        }];
        long timedout = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
        [connection invalidate];
        if (timedout) { fprintf(stderr, "xpc timeout\n"); return 1; }
    }
    return 0;
}
