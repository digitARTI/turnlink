#import "../../../native/codex-vm-supervisor/broker-lease-client.h"
#import "../../../native/codex-vm-supervisor/broker-verifier-protocol.h"
#include <stdio.h>
#include <unistd.h>
int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc != 2 && argc != 7) return 2;
        NSString *digest = argc == 7 ? [NSString stringWithUTF8String:argv[2]] : @"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        NSString *transition = argc == 7 ? [NSString stringWithUTF8String:argv[3]] : @"00000000-0000-4000-8000-000000000001";
        NSString *effect = argc == 7 ? [NSString stringWithUTF8String:argv[4]] : @"00000000-0000-4000-8000-000000000001";
        NSString *resource = argc == 7 ? [NSString stringWithUTF8String:argv[5]] : @"00000000-0000-4000-8000-000000000002";
        NSString *kind = argc == 7 ? [NSString stringWithUTF8String:argv[6]] : @"stop";
        NSMutableArray *leases = [NSMutableArray array];
        for (int i = 0; i < 3; i++) {
            TurnlinkBrokerObservation *lease = TurnlinkAcquireBrokerObservation(digest, transition, effect, resource, kind);
            if (!lease || !lease.valid) return 3; [leases addObject:lease];
        }
        NSXPCConnection *conn = [[NSXPCConnection alloc] initWithServiceName:@"org.turnlink.leasefixture.service"];
        conn.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkBrokerLeaseEndpoint)];
        [conn setCodeSigningRequirement:@"identifier \"org.turnlink.leasefixture.service\""]; [conn activate];
        id<TurnlinkBrokerLeaseEndpoint> proxy = [conn remoteObjectProxyWithErrorHandler:^(NSError *error) { (void)error; }];
        if (strcmp(argv[1], "hold") == 0) { puts("ready"); fflush(stdout); }
#if TURNLINK_BROKER_VERIFIER_FIXTURE
        else if (strcmp(argv[1], "revoke") == 0) [proxy fixtureRevokeAll:^{}];
        else if (strcmp(argv[1], "crash") == 0) [proxy fixtureCrash];
#endif
        else return 2;
        for (int attempt = 0; attempt < 400; attempt++) {
            BOOL any = NO; for (TurnlinkBrokerObservation *lease in leases) any |= lease.valid;
            if (!any) { for (TurnlinkBrokerObservation *lease in leases) [lease close]; [conn invalidate]; puts("invalidated"); return 0; }
            usleep(50000);
        }
        [conn invalidate]; return 4;
    }
}
