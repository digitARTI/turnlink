#import "protocol.h"
#include <unistd.h>
#include <stdlib.h>
#include <libproc.h>
@interface Worker : NSObject <NSXPCListenerDelegate, Gate2Probe>
@end
@implementation Worker
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)conn {
    (void)listener;
    conn.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(Gate2Probe)];
    conn.exportedObject = self;
    [conn resume];
    return YES;
}
- (void)start:(void (^)(int, int, uint64_t, uint64_t))reply {
    pid_t child = fork();
    if (child == 0) {
        setsid();
        close(0); close(1); close(2);
        sleep(30);
        _exit(0);
    }
    uint64_t service_group[5] = {0}, child_group[5] = {0};
    int a = proc_pidinfo(getpid(), 20, 0, service_group, sizeof(service_group));
    int b = proc_pidinfo(child, 20, 0, child_group, sizeof(child_group));
    reply((int)getpid(), (int)child, a == sizeof(service_group) ? service_group[0] : 0,
          b == sizeof(child_group) ? child_group[0] : 0);
}
@end
int main(void) {
    @autoreleasepool {
        Worker *worker = [Worker new];
        NSXPCListener *listener = [NSXPCListener serviceListener];
        listener.delegate = worker;
        [listener resume];
    }
    return 0;
}
