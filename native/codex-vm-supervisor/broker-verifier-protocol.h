#import <Foundation/Foundation.h>

// A point-in-time query only. It is not a lease or permission to dispatch.
@protocol TurnlinkBrokerGrantVerifier
- (void)observeGrant:(NSString *)grantDigest transition:(NSString *)transitionID
              effect:(NSString *)effectID resource:(NSString *)resourceID kind:(NSString *)kind
               nonce:(NSString *)nonce reply:(void (^)(NSString *nonce, NSString *status,
                                                          NSString *grantDigest, NSString *effectID))reply;
#if TURNLINK_BROKER_VERIFIER_FIXTURE
- (void)fixtureBrokerEndpoint:(void (^)(NSXPCListenerEndpoint *))reply;
- (void)fixtureInstallBrokerEndpoint:(NSXPCListenerEndpoint *)endpoint reply:(void (^)(BOOL))reply;
#endif
@end

@protocol TurnlinkBrokerLeaseEvents
- (void)invalidateBrokerObservation:(NSString *)nonce;
@end
@protocol TurnlinkBrokerLeaseEndpoint
- (void)subscribeGrant:(NSString *)grantDigest transition:(NSString *)transitionID
                 effect:(NSString *)effectID resource:(NSString *)resourceID kind:(NSString *)kind
                  nonce:(NSString *)nonce reply:(void (^)(NSString *nonce, NSString *status))reply;
#if TURNLINK_BROKER_VERIFIER_FIXTURE
- (void)fixtureRevokeAll:(void (^)(void))reply;
- (void)fixtureCrash;
#endif
@end
@protocol TurnlinkVerifierEndpoint <TurnlinkBrokerGrantVerifier, TurnlinkBrokerLeaseEndpoint>
@end
