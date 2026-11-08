#import "broker-verifier-protocol.h"
#if TURNLINK_BRIDGE_LAUNCHD_PARENT_TEST || TURNLINK_BRIDGE_SPAWN_REVIEW
#include <spawn.h>
#endif
#if TURNLINK_BRIDGE_LAUNCHD_PARENT_TEST
extern char **environ;
#endif
#if TURNLINK_BRIDGE_SPAWN_REVIEW
#import "broker-executable-check.h"
#if !defined(TURNLINK_BRIDGE_BROKER_EXECUTABLE) || !defined(TURNLINK_BRIDGE_BROKER_IDENTIFIER) || !defined(TURNLINK_BRIDGE_BROKER_TEAM) || !defined(TURNLINK_BRIDGE_BROKER_SHA256) || !defined(TURNLINK_BRIDGE_EXPECTED_GID)
#error "fixed broker executable, identifier, team, SHA-256 and role GID required"
#endif
#endif
#if TURNLINK_BRIDGE_INHERITED_TEST
#import "broker-lease-client.h"
#include <stdio.h>
#endif
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>
#include <string.h>
#include <time.h>
#if TURNLINK_BRIDGE_LAUNCHD_TEST
#include <stdio.h>
#endif
#if TURNLINK_BROKER_VERIFIER_FIXTURE
#include <sys/un.h>
#endif

#ifndef TURNLINK_BRIDGE_EXPECTED_UID
#error "fixed dedicated broker UID required"
#endif
#ifndef TURNLINK_BRIDGE_SERVICE_NAME
#error "fixed bridge Mach service required"
#endif
#ifndef TURNLINK_BRIDGE_CLIENT_IDENTIFIER
#error "fixed supervisor signing identifier required"
#endif
#if !TURNLINK_BROKER_VERIFIER_FIXTURE && !defined(TURNLINK_BRIDGE_CLIENT_TEAM)
#error "fixed supervisor signing team required"
#endif

static NSString *peerRequirement;
static uint64_t monotonicMilliseconds(void) {
    struct timespec now; if (clock_gettime(CLOCK_MONOTONIC, &now)) return 0;
    return (uint64_t)now.tv_sec * 1000 + (uint64_t)now.tv_nsec / 1000000;
}
static BOOL validName(NSString *value) {
    NSCharacterSet *bad = [[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"] invertedSet];
    return value.length > 0 && [value rangeOfCharacterFromSet:bad].location == NSNotFound;
}
static BOOL validUUID(NSString *value) {
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:value]; return uuid && [uuid.UUIDString.lowercaseString isEqualToString:value];
}
@interface Bridge : NSObject <NSXPCListenerDelegate, TurnlinkBrokerLeaseEndpoint>
@property (strong) NSMutableDictionary *entries;
@property (strong) NSMutableData *buffer;
@property BOOL broken;
@property int brokerFD;
@property uint64_t lastPulse;
@property (strong) dispatch_source_t heartbeat;
- (void)consume;
@end
@implementation Bridge
- (instancetype)init { if ((self = [super init])) { _entries = [NSMutableDictionary dictionary]; _buffer = [NSMutableData data]; } return self; }
- (void)disconnectAll {
    @synchronized (self) {
        if (self.broken) return; self.broken = YES;
        for (NSDictionary *entry in self.entries.allValues) {
            NSXPCConnection *connection = entry[@"connection"];
            id<TurnlinkBrokerLeaseEvents> events = [connection remoteObjectProxyWithErrorHandler:^(NSError *error) { (void)error; }];
            [events invalidateBrokerObservation:entry[@"nonce"]];
            void (^reply)(NSString *, NSString *) = entry[@"reply"];
            if (reply) reply(entry[@"nonce"], @"unavailable");
        }
        [self.entries removeAllObjects]; close(self.brokerFD);
    }
}
- (BOOL)send:(NSDictionary *)message {
    NSData *data = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
    if (!data || data.length > 4095 || self.broken) return NO;
    NSMutableData *line = [data mutableCopy]; [line appendBytes:"\n" length:1];
    const uint8_t *bytes = line.bytes; size_t offset = 0;
    while (offset < line.length) {
        ssize_t count = write(self.brokerFD, bytes + offset, line.length - offset);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) { [self disconnectAll]; return NO; }
        offset += (size_t)count;
    }
    return YES;
}
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
    (void)listener; [connection setCodeSigningRequirement:peerRequirement];
    connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkBrokerLeaseEndpoint)];
    connection.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkBrokerLeaseEvents)];
    connection.exportedObject = self;
    __weak Bridge *weak = self; __weak NSXPCConnection *weakConnection = connection;
    connection.invalidationHandler = ^{ [weak releaseConnection:weakConnection]; };
    connection.interruptionHandler = ^{ [weak releaseConnection:weakConnection]; };
    [connection activate]; return YES;
}
- (void)releaseConnection:(NSXPCConnection *)connection {
    if (!connection) return;
    @synchronized (self) {
        for (NSString *key in self.entries.allKeys) {
            if (self.entries[key][@"connection"] != connection) continue;
            [self.entries removeObjectForKey:key]; [self send:@{ @"type": @"release", @"id": key }];
        }
    }
}
- (void)subscribeGrant:(NSString *)digest transition:(NSString *)transition effect:(NSString *)effect resource:(NSString *)resource
                  kind:(NSString *)kind nonce:(NSString *)nonce reply:(void (^)(NSString *, NSString *))reply {
    NSCharacterSet *bad = [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
    NSXPCConnection *connection = NSXPCConnection.currentConnection;
    if (!connection || digest.length != 64 || [digest rangeOfCharacterFromSet:bad].location != NSNotFound ||
        !validUUID(transition) || !validUUID(effect) || !validUUID(resource) || !validUUID(nonce) ||
        !([kind isEqualToString:@"stop"] || [kind isEqualToString:@"remove"])) { reply(nonce ?: @"", @"unavailable"); return; }
    @synchronized (self) {
        if (self.broken || self.entries.count >= 64 || self.entries[nonce]) { reply(nonce, @"unavailable"); return; }
        self.entries[nonce] = [@{ @"connection": connection, @"nonce": nonce, @"reply": [reply copy] } mutableCopy];
        if (![self send:@{ @"type": @"subscribe", @"id": nonce, @"digest": digest, @"transition": transition,
                           @"effect": effect, @"resource": resource, @"kind": kind }]) [self disconnectAll];
    }
}
- (void)consume {
    uint8_t bytes[4096];
    for (;;) {
        ssize_t count = read(self.brokerFD, bytes, sizeof(bytes));
        if (count < 0 && errno == EINTR) continue;
        if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
            struct pollfd wait = { .fd = self.brokerFD, .events = POLLIN };
            if (poll(&wait, 1, 500) < 0 && errno != EINTR) break;
            continue;
        }
        if (count <= 0) break;
        @synchronized (self) {
            [self.buffer appendBytes:bytes length:(NSUInteger)count];
            if (self.buffer.length > 65536) break;
            for (;;) {
                const uint8_t *raw = self.buffer.bytes; NSUInteger end = 0;
                while (end < self.buffer.length && raw[end] != '\n') end++;
                if (end == self.buffer.length) break;
                if (end > 4096) { [self disconnectAll]; break; }
                NSData *line = [self.buffer subdataWithRange:NSMakeRange(0, end)];
                [self.buffer replaceBytesInRange:NSMakeRange(0, end + 1) withBytes:NULL length:0];
                NSDictionary *message = [NSJSONSerialization JSONObjectWithData:line options:0 error:nil];
                if (![message isKindOfClass:NSDictionary.class] || message.count != 2 || ![message[@"id"] isKindOfClass:NSString.class] ||
                    ![message[@"type"] isKindOfClass:NSString.class]) { [self disconnectAll]; break; }
                NSString *key = message[@"id"], *type = message[@"type"];
                if ([type isEqualToString:@"heartbeat"] && [key isEqualToString:@"00000000-0000-0000-0000-000000000000"]) {
                    uint64_t now = monotonicMilliseconds(); if (!now) { [self disconnectAll]; break; }
                    self.lastPulse = now; continue;
                }
                NSMutableDictionary *entry = self.entries[key];
                if (!entry) continue;
                void (^reply)(NSString *, NSString *) = entry[@"reply"];
                if ([type isEqualToString:@"active"] && reply) { [entry removeObjectForKey:@"reply"]; reply(entry[@"nonce"], @"observation-active"); }
                else if ([type isEqualToString:@"refused"] && reply) { [self.entries removeObjectForKey:key]; reply(entry[@"nonce"], @"unavailable"); }
                else if ([type isEqualToString:@"invalidated"]) {
                    [self.entries removeObjectForKey:key];
                    NSXPCConnection *connection = entry[@"connection"];
                    id<TurnlinkBrokerLeaseEvents> events = [connection remoteObjectProxyWithErrorHandler:^(NSError *error) { (void)error; }];
                    [events invalidateBrokerObservation:entry[@"nonce"]]; if (reply) reply(entry[@"nonce"], @"unavailable");
                } else { [self disconnectAll]; break; }
            }
            if (self.broken) break;
        }
    }
    // Closing XPC connections, rather than keeping stale leases alive, is the
    // ultimate fail-closed response even if a notification cannot be sent.
    [self disconnectAll];
#if TURNLINK_BRIDGE_INHERITED_TEST
    puts("bridge-stream-lost"); fflush(stdout);
#endif
    _exit(1);
}
#if TURNLINK_BROKER_VERIFIER_FIXTURE
- (void)fixtureRevokeAll:(void (^)(void))reply { reply(); }
- (void)fixtureCrash { _exit(81); }
#endif
@end
int main(int argc, const char **argv) {
    @autoreleasepool {
#if TURNLINK_BRIDGE_SPAWN_REVIEW
        if (argc != 2 || strcmp(argv[1], "--start") != 0) return 2;
#elif !TURNLINK_BRIDGE_INHERITED_TEST
        (void)argc; (void)argv;
#endif
        NSString *name = @TURNLINK_BRIDGE_SERVICE_NAME, *client = @TURNLINK_BRIDGE_CLIENT_IDENTIFIER;
        if (geteuid() == 0 || geteuid() != (uid_t)TURNLINK_BRIDGE_EXPECTED_UID || getuid() != geteuid() || !validName(name) || !validName(client)) return 2;
#if TURNLINK_BROKER_VERIFIER_FIXTURE
        peerRequirement = [NSString stringWithFormat:@"identifier \"%@\"", client];
#if TURNLINK_BRIDGE_INHERITED_TEST
        if (argc != 6) return 2;
        int fd = 3; struct stat st;
        if (fstat(fd, &st) || !(S_ISSOCK(st.st_mode) || S_ISFIFO(st.st_mode))) return 3;
        NSXPCListener *listener = [NSXPCListener anonymousListener];
#else
        int fd = socket(AF_UNIX, SOCK_STREAM, 0); struct sockaddr_un address = {0}; address.sun_family = AF_UNIX;
        const char *path = TURNLINK_FIXTURE_BROKER_BRIDGE_PATH;
        if (fd < 0 || strlen(path) >= sizeof(address.sun_path)) return 3;
        strlcpy(address.sun_path, path, sizeof(address.sun_path)); if (connect(fd, (struct sockaddr *)&address, sizeof(address))) return 3;
        NSXPCListener *listener = [NSXPCListener serviceListener];
#endif
#else
#if TURNLINK_BRIDGE_LAUNCHD_TEST
        peerRequirement = [NSString stringWithFormat:@"identifier \"%@\"", client];
#else
        NSString *team = @TURNLINK_BRIDGE_CLIENT_TEAM;
        NSCharacterSet *bad = [[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"] invertedSet];
        if (team.length != 10 || [team rangeOfCharacterFromSet:bad].location != NSNotFound) return 3;
        peerRequirement = [NSString stringWithFormat:@"anchor apple generic and identifier \"%@\" and certificate leaf[subject.OU] = \"%@\"", client, team];
#endif
#if TURNLINK_BRIDGE_LAUNCHD_PARENT_TEST
        // Fixture-only inversion: launchd owns this native process; it starts
        // the real broker child and retains the other socketpair endpoint.
        int pair[2]; if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair)) return 3;
        fcntl(pair[0], F_SETFD, FD_CLOEXEC); fcntl(pair[1], F_SETFD, FD_CLOEXEC);
        posix_spawn_file_actions_t actions; posix_spawn_file_actions_init(&actions);
        posix_spawn_file_actions_addclose(&actions, pair[0]);
        posix_spawn_file_actions_adddup2(&actions, pair[1], 3);
        if (pair[1] != 3) posix_spawn_file_actions_addclose(&actions, pair[1]);
#if TURNLINK_FIXTURE_PACKAGED_BROKER
        char *childArgs[] = { (char *)TURNLINK_FIXTURE_PACKAGED_PATH, NULL };
        char *childEnv[] = { "PATH=/usr/bin:/bin", "HOME=/var/empty", "LANG=C", "TURNLINK_PROTECTED_BROKER_TEST_ROOT=" TURNLINK_FIXTURE_TEST_ROOT,
                             "TURNLINK_PROTECTED_BROKER_TEST_UID=" TURNLINK_FIXTURE_TEST_UID,
                             "TURNLINK_PROTECTED_BROKER_TEST_LOG=" TURNLINK_FIXTURE_TEST_LOG, NULL };
        pid_t child; int status = posix_spawn(&child, TURNLINK_FIXTURE_PACKAGED_PATH, &actions, NULL, childArgs, childEnv);
#else
        char *childArgs[] = { (char *)TURNLINK_FIXTURE_NODE, (char *)TURNLINK_FIXTURE_BROKER_SCRIPT, (char *)TURNLINK_FIXTURE_BROKER_CONFIG, NULL };
        pid_t child; int status = posix_spawn(&child, TURNLINK_FIXTURE_NODE, &actions, NULL, childArgs, environ);
#endif
        posix_spawn_file_actions_destroy(&actions); close(pair[1]);
        if (status) { close(pair[0]); return 3; }
        int fd = pair[0];
#elif TURNLINK_BRIDGE_SPAWN_REVIEW
        // Candidate only: no effect-dispatch path is enabled. Launch requires
        // a root-controlled, hardened, specifically signed and hashed binary.
        gid_t groups[128]; int groupCount = getgroups(128, groups);
        if (TURNLINK_BRIDGE_EXPECTED_GID <= 0 || getgid() != (gid_t)TURNLINK_BRIDGE_EXPECTED_GID || getegid() != (gid_t)TURNLINK_BRIDGE_EXPECTED_GID ||
            groupCount < 0) return 3;
        for (int i = 0; i < groupCount; i++) if (groups[i] != (gid_t)TURNLINK_BRIDGE_EXPECTED_GID) return 3;
        if (TURNLINK_BRIDGE_EXPECTED_UID < 450 || TURNLINK_BRIDGE_EXPECTED_UID > 499 ||
            !TurnlinkVerifyBrokerExecutable(@TURNLINK_BRIDGE_BROKER_EXECUTABLE, @TURNLINK_BRIDGE_BROKER_IDENTIFIER,
                                            @TURNLINK_BRIDGE_BROKER_TEAM, @TURNLINK_BRIDGE_BROKER_SHA256)) return 3;
        int pair[2]; if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair)) return 3;
        for (int i = 0; i < 2; i++) {
            if (pair[i] < 4) { int copy = fcntl(pair[i], F_DUPFD_CLOEXEC, 4); if (copy < 0) { close(pair[0]); close(pair[1]); return 3; }
                close(pair[i]); pair[i] = copy; }
        }
        if (fcntl(pair[0], F_SETFD, FD_CLOEXEC) || fcntl(pair[1], F_SETFD, FD_CLOEXEC)) { close(pair[0]); close(pair[1]); return 3; }
        posix_spawn_file_actions_t actions; posix_spawnattr_t attr;
        if (posix_spawn_file_actions_init(&actions)) { close(pair[0]); close(pair[1]); return 3; }
        if (posix_spawnattr_init(&attr)) { posix_spawn_file_actions_destroy(&actions); close(pair[0]); close(pair[1]); return 3; }
        int setup = posix_spawnattr_setflags(&attr, POSIX_SPAWN_CLOEXEC_DEFAULT);
        setup |= posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0);
        setup |= posix_spawn_file_actions_addopen(&actions, 1, "/dev/null", O_WRONLY, 0);
        setup |= posix_spawn_file_actions_addopen(&actions, 2, "/dev/null", O_WRONLY, 0);
        setup |= posix_spawn_file_actions_addclose(&actions, pair[0]);
        if (pair[1] == 3) setup |= posix_spawn_file_actions_addinherit_np(&actions, 3);
        else { setup |= posix_spawn_file_actions_adddup2(&actions, pair[1], 3); setup |= posix_spawn_file_actions_addclose(&actions, pair[1]); }
        char *childArgs[] = { (char *)TURNLINK_BRIDGE_BROKER_EXECUTABLE, NULL };
        char *childEnv[] = { "PATH=/usr/bin:/bin", "HOME=/var/empty", "LANG=C", NULL };
        pid_t child; int status = setup ? setup : posix_spawn(&child, TURNLINK_BRIDGE_BROKER_EXECUTABLE, &actions, &attr, childArgs, childEnv);
        posix_spawnattr_destroy(&attr); posix_spawn_file_actions_destroy(&actions); close(pair[1]);
        if (status) { close(pair[0]); return 3; }
        int fd = pair[0];
#else
        int fd = 3; struct stat st;
        if (fstat(fd, &st) || !(S_ISSOCK(st.st_mode) || S_ISFIFO(st.st_mode))) return 3;
#endif
        NSXPCListener *listener = [[NSXPCListener alloc] initWithMachServiceName:name];
#endif
        int flags = fcntl(fd, F_GETFL);
        if (flags < 0 || fcntl(fd, F_SETFL, flags | O_NONBLOCK) < 0) return 4;
        Bridge *bridge = [Bridge new]; bridge.brokerFD = fd; bridge.lastPulse = monotonicMilliseconds(); listener.delegate = bridge;
        if (!bridge.lastPulse) return 4;
        bridge.heartbeat = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0));
        dispatch_source_set_timer(bridge.heartbeat, dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC), 500 * NSEC_PER_MSEC, 50 * NSEC_PER_MSEC);
        dispatch_source_set_event_handler(bridge.heartbeat, ^{
            @synchronized (bridge) {
                uint64_t now = monotonicMilliseconds();
                if (!now || now < bridge.lastPulse || now - bridge.lastPulse > 3500) {
                    [bridge disconnectAll];
#if TURNLINK_BRIDGE_INHERITED_TEST
                    puts("bridge-heartbeat-expired"); fflush(stdout);
#endif
                    _exit(1);
                }
            }
        });
        dispatch_resume(bridge.heartbeat);
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{ [bridge consume]; });
        [listener activate];
#if TURNLINK_BRIDGE_LAUNCHD_TEST
        fprintf(stderr, "fixture listener activation returned\n"); fflush(stderr);
#endif
#if !TURNLINK_BROKER_VERIFIER_FIXTURE
        dispatch_main();
#endif
#if TURNLINK_BRIDGE_INHERITED_TEST
        NSString *digest = [NSString stringWithUTF8String:argv[1]], *transition = [NSString stringWithUTF8String:argv[2]];
        NSString *effect = [NSString stringWithUTF8String:argv[3]], *resource = [NSString stringWithUTF8String:argv[4]], *kind = [NSString stringWithUTF8String:argv[5]];
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
            NSMutableArray *observations = [NSMutableArray array];
            for (int i = 0; i < 3; i++) {
                TurnlinkBrokerObservation *value = TurnlinkAcquireBrokerObservationAtEndpoint(digest, transition, effect, resource, kind, listener.endpoint);
                if (!value || !value.valid) { puts("selftest-unavailable"); fflush(stdout); _exit(5); }
                [observations addObject:value];
            }
            puts("selftest-ready"); fflush(stdout);
            for (;;) {
                BOOL any = NO; for (TurnlinkBrokerObservation *value in observations) any |= value.valid;
                if (!any) { puts("selftest-invalidated"); fflush(stdout); _exit(0); }
                usleep(50000);
            }
        });
        dispatch_main();
#endif
    }
    return 0;
}
