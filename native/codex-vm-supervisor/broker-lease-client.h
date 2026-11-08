#import <Foundation/Foundation.h>

// Retains a connection and becomes permanently invalid on notification or loss.
// Observation only; it does not authorize any VM or external effect.
@interface TurnlinkBrokerObservation : NSObject
@property (readonly, getter=isValid) BOOL valid;
- (void)close;
@end
TurnlinkBrokerObservation * _Nullable TurnlinkAcquireBrokerObservation(NSString *grantDigest,
    NSString *transitionID, NSString *effectID, NSString *resourceID, NSString *kind);

#if TURNLINK_BROKER_VERIFIER_FIXTURE
TurnlinkBrokerObservation * _Nullable TurnlinkAcquireBrokerObservationAtEndpoint(NSString *grantDigest,
    NSString *transitionID, NSString *effectID, NSString *resourceID, NSString *kind, NSXPCListenerEndpoint *endpoint);
#endif
