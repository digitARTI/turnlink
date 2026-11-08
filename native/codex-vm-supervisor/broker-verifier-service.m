#import "broker-verifier-client.h"
#import "broker-verifier-protocol.h"
#include <errno.h>
#include <fcntl.h>
#include <sys/acl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#ifndef TURNLINK_GRANT_SERVICE_NAME
#error "fixed verifier Mach service required"
#endif
#ifndef TURNLINK_GRANT_EXPECTED_UID
#error "fixed dedicated non-root UID required"
#endif
#ifndef TURNLINK_GRANT_CLIENT_IDENTIFIER
#error "fixed client identifier required"
#endif
#if !TURNLINK_BROKER_VERIFIER_FIXTURE && (!defined(TURNLINK_GRANT_CLIENT_TEAM) || !defined(TURNLINK_GRANT_STATE_DIR))
#error "fixed client team and protected state directory required"
#endif
static NSString *requirement;
static int ownerFD = -1;
#if TURNLINK_BROKER_VERIFIER_FIXTURE
static NSXPCListenerEndpoint *fixtureEndpoint;
#endif
static BOOL identifierOK(NSString *value) {
    NSCharacterSet *bad = [[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"] invertedSet];
    return value.length > 0 && [value rangeOfCharacterFromSet:bad].location == NSNotFound;
}
#if !TURNLINK_BROKER_VERIFIER_FIXTURE
static BOOL noACL(int fd) {
    errno = 0; acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
    if (!acl) return errno == ENOENT;
    acl_entry_t entry; int count = acl_get_entry(acl, ACL_FIRST_ENTRY, &entry); acl_free(acl); return count == 0;
}
static BOOL acquireOwner(void) {
    NSString *path = @TURNLINK_GRANT_STATE_DIR;
    if (![path hasPrefix:@"/"] || [path containsString:@"//"] || path.pathComponents.count < 2) return NO;
    int fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC); if (fd < 0) return NO;
    NSArray<NSString *> *parts = path.pathComponents;
    for (NSUInteger i = 0; i < parts.count; i++) {
        if (i > 0) {
            NSString *part = parts[i];
            if ([part isEqualToString:@"."] || [part isEqualToString:@".."]) { close(fd); return NO; }
            int next = openat(fd, part.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
            close(fd); fd = next; if (fd < 0) return NO;
        }
        struct stat st; BOOL leaf = i == parts.count - 1;
        if (fstat(fd, &st) || !S_ISDIR(st.st_mode) || !noACL(fd) ||
            (leaf ? st.st_uid != geteuid() || (st.st_mode & 0777) != 0700 : st.st_uid != 0 || (st.st_mode & 0022))) { close(fd); return NO; }
    }
    ownerFD = openat(fd, "verifier.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
    close(fd); struct stat st;
    if (ownerFD < 0 || fstat(ownerFD, &st) || !S_ISREG(st.st_mode) || st.st_nlink != 1 || st.st_uid != geteuid() ||
        (st.st_mode & 0777) != 0600 || !noACL(ownerFD) || flock(ownerFD, LOCK_EX | LOCK_NB)) return NO;
    return YES;
}
#endif
@interface Verifier : NSObject <NSXPCListenerDelegate, TurnlinkBrokerGrantVerifier, TurnlinkBrokerLeaseEndpoint>
@end
@implementation Verifier
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
    (void)listener; [connection setCodeSigningRequirement:requirement];
    connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkVerifierEndpoint)];
    connection.exportedObject = self; [connection activate]; return YES;
}
- (void)observeGrant:(NSString *)digest transition:(NSString *)transition effect:(NSString *)effect
            resource:(NSString *)resource kind:(NSString *)kind nonce:(NSString *)nonce
               reply:(void (^)(NSString *, NSString *, NSString *, NSString *))reply {
    // No cached authorization: each request rechecks the fixed broker endpoint.
    // This is an observation, not a lease, and cannot enable VM or effects.
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
#if TURNLINK_BROKER_VERIFIER_FIXTURE
        BOOL authorized = TurnlinkObserveBrokerGrantAtEndpoint(digest, transition, effect, resource, kind, fixtureEndpoint);
#else
        BOOL authorized = TurnlinkObserveBrokerGrant(digest, transition, effect, resource, kind);
#endif
        reply(nonce, authorized ? @"authorized" : @"unavailable", digest, effect);
    });
}
// Snapshot forwarding is insufficient for a retained lease. Production
// always refuses subscriptions until broker revocation is independently wired.
- (void)subscribeGrant:(NSString *)digest transition:(NSString *)transition effect:(NSString *)effect
              resource:(NSString *)resource kind:(NSString *)kind nonce:(NSString *)nonce
                 reply:(void (^)(NSString *, NSString *))reply {
    (void)digest; (void)transition; (void)effect; (void)resource; (void)kind;
    reply(nonce, @"unavailable");
}
#if TURNLINK_BROKER_VERIFIER_FIXTURE
- (void)fixtureRevokeAll:(void (^)(void))reply { reply(); }
- (void)fixtureCrash { _exit(81); }
- (void)fixtureBrokerEndpoint:(void (^)(NSXPCListenerEndpoint *))reply { reply(nil); }
- (void)fixtureInstallBrokerEndpoint:(NSXPCListenerEndpoint *)endpoint reply:(void (^)(BOOL))reply {
    fixtureEndpoint = endpoint; reply(endpoint != nil);
}
#endif
@end
int main(void) {
    @autoreleasepool {
        NSString *name = @TURNLINK_GRANT_SERVICE_NAME, *client = @TURNLINK_GRANT_CLIENT_IDENTIFIER;
        if (geteuid() == 0 || geteuid() != (uid_t)TURNLINK_GRANT_EXPECTED_UID || !identifierOK(name) || !identifierOK(client)) return 2;
#if TURNLINK_BROKER_VERIFIER_FIXTURE
        requirement = [NSString stringWithFormat:@"identifier \"%@\"", client];
        NSXPCListener *listener = [NSXPCListener serviceListener];
#else
        NSString *team = @TURNLINK_GRANT_CLIENT_TEAM;
        NSCharacterSet *bad = [[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"] invertedSet];
        if (team.length != 10 || [team rangeOfCharacterFromSet:bad].location != NSNotFound || !acquireOwner()) return 3;
        requirement = [NSString stringWithFormat:@"anchor apple generic and identifier \"%@\" and certificate leaf[subject.OU] = \"%@\"", client, team];
        NSXPCListener *listener = [[NSXPCListener alloc] initWithMachServiceName:name];
#endif
        Verifier *worker = [Verifier new]; listener.delegate = worker; [listener activate];
    }
    return 0;
}
