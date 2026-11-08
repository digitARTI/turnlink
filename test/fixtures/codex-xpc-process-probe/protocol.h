#import <Foundation/Foundation.h>
@protocol Gate2Probe
- (void)start:(void (^)(int, int, uint64_t, uint64_t))reply;
@end
