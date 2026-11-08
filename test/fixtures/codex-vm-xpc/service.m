#import "protocol.h"
#include <errno.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

// The caller-supplied path is acceptable only in this same-user disposable
// fixture. A real privileged service must never trust it.
static NSString *state(NSString *dir) {
    int root = open(dir.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (root < 0) return @"error";
    const char *names[] = {"pending", "revoked"};
    for (int i = 0; i < 2; i++) {
        struct stat info;
        if (fstatat(root, names[i], &info, AT_SYMLINK_NOFOLLOW) == 0) { close(root); return @"fenced"; }
        if (errno != ENOENT) { close(root); return @"error"; }
    }
    close(root); return @"open-no-dispatch";
}
@interface Worker : NSObject <NSXPCListenerDelegate, TurnlinkVMFixture>
@end
@implementation Worker
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
    (void)listener;
    // This ad-hoc identifier is test-only: same-UID users can forge it.
    [connection setCodeSigningRequirement:@"identifier \"org.turnlink.vmfixture.client\""];
    connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkVMFixture)];
    connection.exportedObject = self;
    [connection resume];
    return YES;
}
- (void)stateAt:(NSString *)dir reply:(void (^)(NSString *))reply {
    @synchronized (self) { reply(state(dir)); }
}
- (void)revokeAt:(NSString *)dir crashBeforeCommit:(BOOL)crash reply:(void (^)(NSString *))reply {
    @synchronized (self) {
    NSString *pending = [dir stringByAppendingPathComponent:@"pending"];
    NSString *committed = [dir stringByAppendingPathComponent:@"revoked"];
    int root = open(dir.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (root < 0) { reply(@"error"); return; }
    int fd = openat(root, "pending", O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW, 0600);
    if (fd < 0) { close(root); reply(@"error"); return; }
    BOOL ok = write(fd, "revoked\n", 8) == 8 && fsync(fd) == 0;
    if (close(fd) != 0) ok = NO;
    if (ok) ok = fsync(root) == 0;
    if (!ok) { close(root); reply(@"error"); return; }
    if (crash) _exit(77);
    ok = rename(pending.fileSystemRepresentation, committed.fileSystemRepresentation) == 0 && fsync(root) == 0;
    close(root);
    reply(ok ? @"durable" : @"error");
    }
}
@end
int main(void) {
    @autoreleasepool {
        Worker *worker = [Worker new];
        NSXPCListener *listener = [NSXPCListener serviceListener];
        listener.delegate = worker;
        [listener resume];
    }
    return 0;
}
