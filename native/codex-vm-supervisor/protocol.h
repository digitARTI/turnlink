#import <Foundation/Foundation.h>

// There is intentionally no effect, VM, Docker, or unfence operation.
@protocol TurnlinkVMSupervisor
- (void)status:(void (^)(NSString *))reply;
- (void)observeRevocation:(void (^)(NSString *))reply;
- (void)revoke:(void (^)(NSString *))reply;
- (void)startVM:(void (^)(NSString *))reply;
- (void)pauseVM:(void (^)(NSString *))reply;
#if TURNLINK_VM_FIXTURE
- (void)stopFixture:(void (^)(NSString *))reply;
- (void)crashAfterPending:(void (^)(NSString *))reply;
- (void)crashBeforePending:(void (^)(NSString *))reply;
- (void)crashDuringPending:(void (^)(NSString *))reply;
#if TURNLINK_VM_DAEMON_FIXTURE
- (void)openFixtureStream:(uint32_t)port reply:(void (^)(NSFileHandle *))reply;
- (void)daemonPing:(void (^)(NSString *))reply;
- (void)daemonWrongKey:(void (^)(NSString *))reply;
- (void)daemonRevokeAndCrash:(void (^)(NSString *))reply;
- (void)daemonRecover:(void (^)(NSString *))reply;
#endif
#endif
@end
