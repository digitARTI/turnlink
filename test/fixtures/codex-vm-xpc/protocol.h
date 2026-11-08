#import <Foundation/Foundation.h>

// Disposable fixture protocol: there is deliberately no Docker dispatch.
@protocol TurnlinkVMFixture
- (void)stateAt:(NSString *)directory reply:(void (^)(NSString *))reply;
- (void)revokeAt:(NSString *)directory crashBeforeCommit:(BOOL)crash reply:(void (^)(NSString *))reply;
@end
