#import "../../../native/codex-vm-supervisor/broker-verifier-protocol.h"
#include <unistd.h>
static NSXPCListener *brokerListener;
static NSXPCListener *anonymousListener;
@interface Worker : NSObject <NSXPCListenerDelegate, TurnlinkBrokerGrantVerifier>
@end
@implementation Worker
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
    (void)listener;
#if TURNLINK_FIXTURE_BROKER_PROXY
    [connection setCodeSigningRequirement:@"identifier \"org.turnlink.grantfixture.service\" or identifier \"org.turnlink.vmfixture.client\""];
#else
    [connection setCodeSigningRequirement:@"identifier \"org.turnlink.vmfixture.client\""];
#endif
    connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkBrokerGrantVerifier)];
    connection.exportedObject = self; [connection activate]; return YES;
}
- (void)observeGrant:(NSString *)digest transition:(NSString *)transition effect:(NSString *)effect
            resource:(NSString *)resource kind:(NSString *)kind nonce:(NSString *)nonce
               reply:(void (^)(NSString *, NSString *, NSString *, NSString *))reply {
    if ([effect hasSuffix:@"000000000003"]) _exit(81);
    NSString *answer = [effect hasSuffix:@"000000000002"] ? @"wrong-nonce" : nonce;
    BOOL good = [digest isEqualToString:@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] &&
        [transition isEqualToString:@"00000000-0000-4000-8000-000000000001"] &&
        [resource isEqualToString:@"00000000-0000-4000-8000-000000000002"] && [kind isEqualToString:@"stop"];
    reply(answer, good ? @"authorized" : @"refused", digest, effect);
}
#if TURNLINK_BROKER_VERIFIER_FIXTURE
- (void)fixtureBrokerEndpoint:(void (^)(NSXPCListenerEndpoint *))reply { reply(anonymousListener.endpoint); }
- (void)fixtureInstallBrokerEndpoint:(NSXPCListenerEndpoint *)endpoint reply:(void (^)(BOOL))reply { (void)endpoint; reply(NO); }
#endif
@end
int main(void) { @autoreleasepool { Worker *worker = [Worker new]; brokerListener = [NSXPCListener serviceListener]; brokerListener.delegate = worker; anonymousListener = [NSXPCListener anonymousListener]; anonymousListener.delegate = worker; [anonymousListener activate]; [brokerListener activate]; } return 0; }
