#import "broker-lease-client.h"
#import "broker-verifier-protocol.h"
#include <stdio.h>
#ifndef TURNLINK_BROKER_LEASE_SERVICE
#error "fixed broker lease service required"
#endif
#ifndef TURNLINK_BROKER_LEASE_IDENTIFIER
#error "fixed broker lease identity required"
#endif
#if !TURNLINK_BROKER_VERIFIER_FIXTURE && !defined(TURNLINK_BROKER_LEASE_TEAM)
#error "fixed broker lease team required"
#endif

@interface TurnlinkBrokerObservation () <TurnlinkBrokerLeaseEvents>
@property (strong) NSLock *lock;
@property (strong) NSXPCConnection *connection;
@property (copy) NSString *nonce;
@property BOOL open;
@property BOOL admitted;
@end
@implementation TurnlinkBrokerObservation
- (BOOL)isValid { [self.lock lock]; BOOL value = self.open && self.admitted; [self.lock unlock]; return value; }
- (void)invalidateBrokerObservation:(NSString *)nonce {
    [self.lock lock]; if ([nonce isEqualToString:self.nonce]) self.open = NO; [self.lock unlock];
}
- (void)invalidate { [self.lock lock]; self.open = NO; [self.lock unlock]; }
- (void)close { [self invalidate]; [self.connection invalidate]; }
@end

static BOOL identifierOK(NSString *value) {
    NSCharacterSet *bad = [[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"] invertedSet];
    return value.length > 0 && [value rangeOfCharacterFromSet:bad].location == NSNotFound;
}
static BOOL uuidOK(NSString *value) { NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:value]; return uuid && [uuid.UUIDString.lowercaseString isEqualToString:value]; }
static TurnlinkBrokerObservation *acquire(NSString *digest, NSString *transition, NSString *effect, NSString *resource, NSString *kind,
                                         NSXPCListenerEndpoint *endpoint) {
    NSString *service = @TURNLINK_BROKER_LEASE_SERVICE, *identifier = @TURNLINK_BROKER_LEASE_IDENTIFIER;
    NSCharacterSet *bad = [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
    if (!identifierOK(service) || !identifierOK(identifier) || digest.length != 64 || [digest rangeOfCharacterFromSet:bad].location != NSNotFound ||
        !uuidOK(transition) || !uuidOK(effect) || !uuidOK(resource) || !([kind isEqualToString:@"stop"] || [kind isEqualToString:@"remove"])) return nil;
#if TURNLINK_BROKER_VERIFIER_FIXTURE
    NSString *requirement = [NSString stringWithFormat:@"identifier \"%@\"", identifier];
    NSXPCConnection *conn = endpoint ? [[NSXPCConnection alloc] initWithListenerEndpoint:endpoint] : [[NSXPCConnection alloc] initWithServiceName:service];
#else
    (void)endpoint;
#if TURNLINK_BROKER_LEASE_USER_DOMAIN_TEST
    NSString *requirement = [NSString stringWithFormat:@"identifier \"%@\"", identifier];
    NSXPCConnection *conn = [[NSXPCConnection alloc] initWithMachServiceName:service options:0];
#else
    NSString *team = @TURNLINK_BROKER_LEASE_TEAM;
    NSCharacterSet *badTeam = [[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"] invertedSet];
    if (team.length != 10 || [team rangeOfCharacterFromSet:badTeam].location != NSNotFound) return nil;
    NSString *requirement = [NSString stringWithFormat:@"anchor apple generic and identifier \"%@\" and certificate leaf[subject.OU] = \"%@\"", identifier, team];
    NSXPCConnection *conn = [[NSXPCConnection alloc] initWithMachServiceName:service options:NSXPCConnectionPrivileged];
#endif
#endif
    TurnlinkBrokerObservation *observation = [TurnlinkBrokerObservation new];
    observation.lock = [NSLock new]; observation.connection = conn; observation.nonce = NSUUID.UUID.UUIDString.lowercaseString; observation.open = YES;
    conn.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkBrokerLeaseEndpoint)];
    conn.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkBrokerLeaseEvents)]; conn.exportedObject = observation;
    [conn setCodeSigningRequirement:requirement];
    __weak TurnlinkBrokerObservation *weak = observation;
    conn.invalidationHandler = ^{ [weak invalidate]; }; conn.interruptionHandler = ^{ [weak invalidate]; };
    [conn activate]; dispatch_semaphore_t done = dispatch_semaphore_create(0);
    id<TurnlinkBrokerLeaseEndpoint> proxy = [conn remoteObjectProxyWithErrorHandler:^(NSError *error) {
#if TURNLINK_BROKER_LEASE_USER_DOMAIN_TEST
        fprintf(stderr, "fixture peer error: %s\n", error.description.UTF8String);
#else
        (void)error;
#endif
        [weak invalidate]; dispatch_semaphore_signal(done);
    }];
    [proxy subscribeGrant:digest transition:transition effect:effect resource:resource kind:kind nonce:observation.nonce reply:^(NSString *nonce, NSString *status) {
        [observation.lock lock];
        if (observation.open && [nonce isEqualToString:observation.nonce] && [status isEqualToString:@"observation-active"]) observation.admitted = YES;
        else observation.open = NO;
        [observation.lock unlock]; dispatch_semaphore_signal(done);
    }];
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC))) [observation invalidate];
    if (!observation.valid) { [observation close]; return nil; }
    return observation;
}

TurnlinkBrokerObservation *TurnlinkAcquireBrokerObservation(NSString *digest, NSString *transition, NSString *effect, NSString *resource, NSString *kind) {
    return acquire(digest, transition, effect, resource, kind, nil);
}
#if TURNLINK_BROKER_VERIFIER_FIXTURE
TurnlinkBrokerObservation *TurnlinkAcquireBrokerObservationAtEndpoint(NSString *digest, NSString *transition, NSString *effect, NSString *resource, NSString *kind,
                                                                      NSXPCListenerEndpoint *endpoint) {
    if (!endpoint) return nil;
    return acquire(digest, transition, effect, resource, kind, endpoint);
}
#endif
