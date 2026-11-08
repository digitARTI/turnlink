#import "broker-verifier-client.h"
#import "broker-verifier-protocol.h"

#ifndef TURNLINK_BROKER_VERIFIER_SERVICE
#error "fixed verifier Mach service required"
#endif
#ifndef TURNLINK_BROKER_VERIFIER_IDENTIFIER
#error "fixed verifier signing identifier required"
#endif
#if !TURNLINK_BROKER_VERIFIER_FIXTURE && !defined(TURNLINK_BROKER_VERIFIER_TEAM)
#error "fixed verifier Apple team required"
#endif

static BOOL identifierOK(NSString *value) {
    NSCharacterSet *bad = [[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"] invertedSet];
    return value.length > 0 && [value rangeOfCharacterFromSet:bad].location == NSNotFound;
}
static BOOL uuidOK(NSString *value) {
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:value];
    return uuid && [uuid.UUIDString.lowercaseString isEqualToString:value];
}
static BOOL observe(NSString *digest, NSString *transition, NSString *effect, NSString *resource, NSString *kind,
                    NSXPCListenerEndpoint *endpoint) {
    NSString *service = @TURNLINK_BROKER_VERIFIER_SERVICE, *identifier = @TURNLINK_BROKER_VERIFIER_IDENTIFIER;
    NSCharacterSet *badHex = [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
    if (!identifierOK(service) || !identifierOK(identifier) || digest.length != 64 ||
        [digest rangeOfCharacterFromSet:badHex].location != NSNotFound || !uuidOK(transition) || !uuidOK(effect) || !uuidOK(resource) ||
        !([kind isEqualToString:@"stop"] || [kind isEqualToString:@"remove"])) return NO;
#if TURNLINK_BROKER_VERIFIER_FIXTURE
    NSString *requirement = [NSString stringWithFormat:@"identifier \"%@\"", identifier];
    NSXPCConnection *conn = endpoint ? [[NSXPCConnection alloc] initWithListenerEndpoint:endpoint] :
        [[NSXPCConnection alloc] initWithServiceName:service];
#else
    (void)endpoint;
    NSString *team = @TURNLINK_BROKER_VERIFIER_TEAM;
    NSCharacterSet *badTeam = [[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"] invertedSet];
    if (team.length != 10 || [team rangeOfCharacterFromSet:badTeam].location != NSNotFound) return NO;
    NSString *requirement = [NSString stringWithFormat:@"anchor apple generic and identifier \"%@\" and certificate leaf[subject.OU] = \"%@\"", identifier, team];
    NSXPCConnection *conn = [[NSXPCConnection alloc] initWithMachServiceName:service options:NSXPCConnectionPrivileged];
#endif
    conn.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkBrokerGrantVerifier)];
    [conn setCodeSigningRequirement:requirement];
    dispatch_semaphore_t done = dispatch_semaphore_create(0); NSLock *lock = [NSLock new];
    __block BOOL complete = NO, accepted = NO;
    void (^finish)(BOOL) = ^(BOOL ok) { [lock lock]; if (!complete) { complete = YES; accepted = ok; dispatch_semaphore_signal(done); } [lock unlock]; };
    conn.interruptionHandler = ^{ finish(NO); }; conn.invalidationHandler = ^{ finish(NO); };
    [conn activate];
    id<TurnlinkBrokerGrantVerifier> proxy = [conn remoteObjectProxyWithErrorHandler:^(NSError *error) { (void)error; finish(NO); }];
    NSString *nonce = NSUUID.UUID.UUIDString.lowercaseString;
    [proxy observeGrant:digest transition:transition effect:effect resource:resource kind:kind nonce:nonce
                 reply:^(NSString *receivedNonce, NSString *status, NSString *receivedDigest, NSString *receivedEffect) {
        finish([receivedNonce isEqualToString:nonce] && [status isEqualToString:@"authorized"] &&
               [receivedDigest isEqualToString:digest] && [receivedEffect isEqualToString:effect]);
    }];
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC))) finish(NO);
    [lock lock]; BOOL result = accepted; [lock unlock];
    [conn invalidate]; return result;
}

BOOL TurnlinkObserveBrokerGrant(NSString *digest, NSString *transition, NSString *effect, NSString *resource, NSString *kind) {
    return observe(digest, transition, effect, resource, kind, nil);
}
#if TURNLINK_BROKER_VERIFIER_FIXTURE
BOOL TurnlinkObserveBrokerGrantAtEndpoint(NSString *digest, NSString *transition, NSString *effect, NSString *resource, NSString *kind,
                                          NSXPCListenerEndpoint *endpoint) {
    if (!endpoint) return NO;
    return observe(digest, transition, effect, resource, kind, endpoint);
}
#endif
