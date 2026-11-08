#import <Foundation/Foundation.h>

// Queries the fixed broker verifier; a successful answer is historical only.
// No VM/effect dispatch may rely on it as a retained authorization lease.
BOOL TurnlinkObserveBrokerGrant(NSString *grantDigest, NSString *transitionID,
                                NSString *effectID, NSString *resourceID, NSString *kind);

#if TURNLINK_BROKER_VERIFIER_FIXTURE
BOOL TurnlinkObserveBrokerGrantAtEndpoint(NSString *grantDigest, NSString *transitionID,
                                         NSString *effectID, NSString *resourceID, NSString *kind,
                                         NSXPCListenerEndpoint *endpoint);
#endif
