#import "../../../native/codex-vm-supervisor/broker-verifier-protocol.h"
#include <unistd.h>
#if TURNLINK_FIXTURE_BROKER_BRIDGE
#include <sys/socket.h>
#include <sys/un.h>
#endif
@interface LeaseFixture : NSObject <NSXPCListenerDelegate, TurnlinkBrokerLeaseEndpoint>
@property (strong) NSMutableArray *subscribers;
@property BOOL revoked;
@end
@implementation LeaseFixture
- (instancetype)init { if ((self = [super init])) _subscribers = [NSMutableArray array]; return self; }
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
    (void)listener; [connection setCodeSigningRequirement:@"identifier \"org.turnlink.vmfixture.client\""];
    connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkBrokerLeaseEndpoint)];
    connection.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkBrokerLeaseEvents)];
    connection.exportedObject = self; [connection activate]; return YES;
}
- (void)subscribeGrant:(NSString *)digest transition:(NSString *)transition effect:(NSString *)effect resource:(NSString *)resource
                  kind:(NSString *)kind nonce:(NSString *)nonce reply:(void (^)(NSString *, NSString *))reply {
#if TURNLINK_FIXTURE_BROKER_BRIDGE
    NSXPCConnection *source = NSXPCConnection.currentConnection;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
        int fd = socket(AF_UNIX, SOCK_STREAM, 0);
        struct sockaddr_un address = {0}; address.sun_family = AF_UNIX;
        const char *path = TURNLINK_FIXTURE_BROKER_BRIDGE_PATH;
        if (fd < 0 || strlen(path) >= sizeof(address.sun_path)) { if (fd >= 0) close(fd); reply(nonce, @"unavailable"); return; }
        strlcpy(address.sun_path, path, sizeof(address.sun_path));
        struct timeval timeout = { .tv_sec = 5, .tv_usec = 0 }; setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
        NSDictionary *request = @{ @"type": @"subscribe", @"id": nonce, @"digest": digest, @"transition": transition,
                                    @"effect": effect, @"resource": resource, @"kind": kind };
        NSData *data = [NSJSONSerialization dataWithJSONObject:request options:0 error:nil];
        if (!data || connect(fd, (struct sockaddr *)&address, sizeof(address)) ||
            write(fd, data.bytes, data.length) != (ssize_t)data.length || write(fd, "\n", 1) != 1) { close(fd); reply(nonce, @"unavailable"); return; }
        NSMutableData *line = [NSMutableData data]; char byte;
        while (line.length < 4096 && read(fd, &byte, 1) == 1 && byte != '\n') [line appendBytes:&byte length:1];
        NSDictionary *answer = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
        if (![answer isKindOfClass:NSDictionary.class] || ![answer[@"type"] isEqual:@"active"] || ![answer[@"id"] isEqual:nonce]) {
            close(fd); reply(nonce, @"unavailable"); return;
        }
        timeout.tv_sec = 0; setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
        reply(nonce, @"observation-active");
        // Any further message or EOF terminates this observation. A broker
        // revocation is sent before the stream is closed.
        char ignored[64]; (void)read(fd, ignored, sizeof(ignored));
        close(fd);
        id<TurnlinkBrokerLeaseEvents> events = [source remoteObjectProxyWithErrorHandler:^(NSError *error) { (void)error; }];
        [events invalidateBrokerObservation:nonce];
    });
#else
    @synchronized (self) {
        BOOL good = !self.revoked && [digest isEqualToString:@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] &&
            [transition isEqualToString:@"00000000-0000-4000-8000-000000000001"] &&
            [resource isEqualToString:@"00000000-0000-4000-8000-000000000002"] && [kind isEqualToString:@"stop"];
        if (good) [self.subscribers addObject:@{ @"connection": NSXPCConnection.currentConnection, @"nonce": nonce }];
        reply(nonce, good ? @"observation-active" : @"unavailable");
    }
#endif
}
- (void)fixtureRevokeAll:(void (^)(void))reply {
    @synchronized (self) {
        self.revoked = YES;
        for (NSDictionary *entry in self.subscribers) {
            NSXPCConnection *connection = entry[@"connection"];
            id<TurnlinkBrokerLeaseEvents> events = [connection remoteObjectProxyWithErrorHandler:^(NSError *error) { (void)error; }];
            [events invalidateBrokerObservation:entry[@"nonce"]];
        }
        [self.subscribers removeAllObjects]; reply();
    }
}
- (void)fixtureCrash { _exit(81); }
@end
int main(void) { @autoreleasepool { LeaseFixture *worker = [LeaseFixture new]; NSXPCListener *listener = [NSXPCListener serviceListener]; listener.delegate = worker; [listener activate]; } return 0; }
