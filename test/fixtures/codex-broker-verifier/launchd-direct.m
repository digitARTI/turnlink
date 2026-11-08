#import "../../../native/codex-vm-supervisor/broker-verifier-protocol.h"
#include <fcntl.h>
#include <unistd.h>
@interface Worker : NSObject <NSXPCListenerDelegate, TurnlinkBrokerLeaseEndpoint>
@end
@implementation Worker
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
    (void)listener; [connection setCodeSigningRequirement:@"identifier \"org.turnlink.vmfixture.client\""];
    connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkBrokerLeaseEndpoint)];
    connection.exportedObject = self; [connection activate]; return YES;
}
- (void)subscribeGrant:(NSString *)digest transition:(NSString *)transition effect:(NSString *)effect resource:(NSString *)resource
                  kind:(NSString *)kind nonce:(NSString *)nonce reply:(void (^)(NSString *, NSString *))reply {
    (void)digest; (void)transition; (void)effect; (void)resource; (void)kind;
    int fd = open(TURNLINK_FIXTURE_LOG, O_WRONLY | O_CREAT | O_APPEND, 0600);
    if (fd >= 0) { write(fd, "SUBSCRIBE\n", 10); close(fd); }
    reply(nonce, @"unavailable");
}
@end
int main(void) { @autoreleasepool { Worker *worker = [Worker new];
    NSXPCListener *listener = [[NSXPCListener alloc] initWithMachServiceName:@TURNLINK_BRIDGE_SERVICE_NAME];
    listener.delegate = worker; [listener activate]; dispatch_main(); } return 0; }
