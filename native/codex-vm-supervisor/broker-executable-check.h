#import <Foundation/Foundation.h>
// Verifies only an on-disk candidate before launch; not a two-UID isolation proof.
BOOL TurnlinkVerifyBrokerExecutable(NSString *path, NSString *identifier, NSString *team, NSString *sha256);
