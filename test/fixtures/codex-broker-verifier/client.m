#import "../../../native/codex-vm-supervisor/broker-verifier-client.h"
#import "../../../native/codex-vm-supervisor/broker-verifier-protocol.h"
#include <stdio.h>
#if TURNLINK_FIXTURE_SETUP_PROXY
static BOOL setup(void) {
    dispatch_semaphore_t done = dispatch_semaphore_create(0); __block NSXPCListenerEndpoint *endpoint;
    NSXPCConnection *broker = [[NSXPCConnection alloc] initWithServiceName:@"org.turnlink.brokerfixture.service"];
    broker.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkBrokerGrantVerifier)];
    [broker setCodeSigningRequirement:@"identifier \"org.turnlink.brokerfixture.service\""]; [broker activate];
    id<TurnlinkBrokerGrantVerifier> proxy = [broker remoteObjectProxyWithErrorHandler:^(NSError *error) { fprintf(stderr, "fixture xpc error: %s\n", error.description.UTF8String); dispatch_semaphore_signal(done); }];
    [proxy fixtureBrokerEndpoint:^(NSXPCListenerEndpoint *value) { endpoint = value; dispatch_semaphore_signal(done); }];
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) || !endpoint) { [broker invalidate]; return NO; }
    NSXPCConnection *verifier = [[NSXPCConnection alloc] initWithServiceName:@"org.turnlink.grantfixture.service"];
    verifier.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkBrokerGrantVerifier)];
    [verifier setCodeSigningRequirement:@"identifier \"org.turnlink.grantfixture.service\""]; [verifier activate];
    __block BOOL installed = NO;
    id<TurnlinkBrokerGrantVerifier> target = [verifier remoteObjectProxyWithErrorHandler:^(NSError *error) { fprintf(stderr, "fixture xpc error: %s\n", error.description.UTF8String); dispatch_semaphore_signal(done); }];
    [target fixtureInstallBrokerEndpoint:endpoint reply:^(BOOL ok) { installed = ok; dispatch_semaphore_signal(done); }];
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC))) installed = NO;
    [verifier invalidate]; [broker invalidate]; return installed;
}
#endif
int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc != 2) return 2;
#if TURNLINK_FIXTURE_SETUP_PROXY
        if (!setup()) { fprintf(stderr, "fixture endpoint setup failed\n"); return 1; }
#endif
        NSString *mode = [NSString stringWithUTF8String:argv[1]];
        NSString *digest = [mode isEqualToString:@"foreign"] ? @"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" : @"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        NSString *effect = [mode isEqualToString:@"nonce"] ? @"00000000-0000-4000-8000-000000000002" :
                           [mode isEqualToString:@"crash"] ? @"00000000-0000-4000-8000-000000000003" : @"00000000-0000-4000-8000-000000000001";
        BOOL answer = TurnlinkObserveBrokerGrant(digest, @"00000000-0000-4000-8000-000000000001", effect,
                       @"00000000-0000-4000-8000-000000000002", @"stop");
        puts(answer ? "authorized-snapshot" : "unavailable"); return 0;
    }
}
