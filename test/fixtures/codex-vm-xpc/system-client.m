#import "../../../native/codex-vm-supervisor/protocol.h"
#include <stdio.h>
#include <errno.h>
#include <signal.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>
#ifndef TURNLINK_VM_SERVICE_NAME
#define TURNLINK_VM_SERVICE_NAME "org.turnlink.vmfixture.service"
#endif

#if TURNLINK_VM_DAEMON_FIXTURE
#include "stream-pump.h"
static int bridgeListener = -1;
static ino_t bridgeInode;
static NSString *bridgePath;
static dispatch_semaphore_t bridgeSlots;

static void pump(int source, int target, dispatch_group_t group) {
    turnlinkPump(source, target); dispatch_group_leave(group);
}

static BOOL startFixtureBridge(NSString *path, id<TurnlinkVMSupervisor> proxy) {
    if (!path.isAbsolutePath || strlen(path.fileSystemRepresentation) >= sizeof(((struct sockaddr_un *)0)->sun_path)) return NO;
    struct stat parent, existing;
    if (lstat(path.stringByDeletingLastPathComponent.fileSystemRepresentation, &parent) || !S_ISDIR(parent.st_mode) ||
        parent.st_uid != geteuid() || (parent.st_mode & 077) || lstat(path.fileSystemRepresentation, &existing) == 0 || errno != ENOENT) return NO;
    int listener = socket(AF_UNIX, SOCK_STREAM, 0); if (listener < 0) return NO;
    struct sockaddr_un address = { .sun_family = AF_UNIX }; strlcpy(address.sun_path, path.fileSystemRepresentation, sizeof(address.sun_path));
    if (bind(listener, (struct sockaddr *)&address, sizeof(address))) { close(listener); return NO; }
    if (lstat(path.fileSystemRepresentation, &existing) || !S_ISSOCK(existing.st_mode) || existing.st_uid != geteuid()) { close(listener); return NO; }
    ino_t created = existing.st_ino;
    if (chmod(path.fileSystemRepresentation, 0600) || lstat(path.fileSystemRepresentation, &existing) ||
        !S_ISSOCK(existing.st_mode) || existing.st_ino != created || listen(listener, 16)) {
        struct stat current; close(listener);
        if (!lstat(path.fileSystemRepresentation, &current) && S_ISSOCK(current.st_mode) && current.st_ino == created) unlink(path.fileSystemRepresentation);
        return NO;
    }
    bridgeListener = listener; bridgeInode = existing.st_ino; bridgePath = [path copy]; bridgeSlots = dispatch_semaphore_create(32);
    signal(SIGPIPE, SIG_IGN);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
        for (;;) {
            int client = accept(listener, NULL, NULL); if (client < 0) break;
            if (dispatch_semaphore_wait(bridgeSlots, DISPATCH_TIME_NOW)) { close(client); continue; }
            dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
                struct timeval limit = { .tv_sec = 5, .tv_usec = 0 };
                setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &limit, sizeof(limit));
                char kind; if (read(client, &kind, 1) != 1 || (kind != 'C' && kind != 'A' && kind != 'I')) { close(client); dispatch_semaphore_signal(bridgeSlots); return; }
                limit.tv_sec = 0; setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &limit, sizeof(limit));
                dispatch_semaphore_t ready = dispatch_semaphore_create(0); __block int remote = -1; __block BOOL expired = NO;
                [proxy openFixtureStream:kind == 'C' ? 4052 : kind == 'A' ? 4051 : 4053 reply:^(NSFileHandle *handle) {
                    @synchronized (ready) { if (!expired && handle) remote = dup(handle.fileDescriptor); }
                    dispatch_semaphore_signal(ready);
                }];
                long timeout = dispatch_semaphore_wait(ready, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC));
                @synchronized (ready) { if (timeout) { expired = YES; if (remote >= 0) { close(remote); remote = -1; } } }
                if (timeout || remote < 0) { close(client); dispatch_semaphore_signal(bridgeSlots); return; }
                dispatch_group_t group = dispatch_group_create(); dispatch_group_enter(group); dispatch_group_enter(group);
                dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{ pump(client, remote, group); });
                dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{ pump(remote, client, group); });
                dispatch_group_notify(group, dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{ close(client); close(remote); dispatch_semaphore_signal(bridgeSlots); });
            });
        }
    });
    return YES;
}

static void stopFixtureBridge(void) {
    if (bridgeListener >= 0) { shutdown(bridgeListener, SHUT_RDWR); close(bridgeListener); bridgeListener = -1; }
    struct stat current;
    if (bridgePath && !lstat(bridgePath.fileSystemRepresentation, &current) && S_ISSOCK(current.st_mode) && current.st_ino == bridgeInode)
        unlink(bridgePath.fileSystemRepresentation);
}
#endif

int main(int argc, const char **argv) {
    if (argc != 2 && argc != 3) return 2;
    @autoreleasepool {
        NSString *mode = [NSString stringWithUTF8String:argv[1]];
        NSXPCConnection *conn = [[NSXPCConnection alloc] initWithServiceName:@TURNLINK_VM_SERVICE_NAME];
        conn.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkVMSupervisor)];
        if ([mode isEqualToString:@"service-auth-good"])
            [conn setCodeSigningRequirement:[NSString stringWithFormat:@"identifier \"%@\"", @TURNLINK_VM_SERVICE_NAME]];
        else if ([mode isEqualToString:@"service-auth-bad"])
            [conn setCodeSigningRequirement:@"identifier \"org.turnlink.vmfixture.wrong\""];
        [conn activate];
        dispatch_semaphore_t done = dispatch_semaphore_create(0); __block int result = 1;
        id<TurnlinkVMSupervisor> proxy = [conn remoteObjectProxyWithErrorHandler:^(NSError *error) {
            fprintf(stderr, "xpc-error: %s\n", error.description.UTF8String); dispatch_semaphore_signal(done);
        }];
        void (^reply)(NSString *) = ^(NSString *value) {
            printf("%s\n", value.UTF8String); fflush(stdout); result = 0; dispatch_semaphore_signal(done);
        };
#if TURNLINK_VM_DAEMON_FIXTURE
        if ([mode isEqualToString:@"daemon-broker-bridge"]) {
            [proxy startVM:^(NSString *started) {
                if (![started isEqualToString:@"vm-started-fixture"]) { reply(started); return; }
                puts("vm-started-fixture"); fflush(stdout);
                [proxy daemonPing:^(NSString *ping) { reply(ping); }];
            }];
            if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, (argc == 3 ? 120 : 40) * NSEC_PER_SEC)) || result != 0) { [conn invalidate]; return 1; }
            if (argc == 3) {
                NSString *path = [NSString stringWithUTF8String:argv[2]];
                if (!startFixtureBridge(path, proxy)) { [conn invalidate]; return 1; }
                printf("vm-docker-bridge-ready %s\n", path.fileSystemRepresentation); fflush(stdout);
            }
            char command[64];
            if (!fgets(command, sizeof(command), stdin)) { stopFixtureBridge(); [conn invalidate]; return 2; }
            if (strcmp(command, "stop\n") == 0) {
                stopFixtureBridge();
                result = 1; [proxy stopFixture:reply];
                int failed = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 40 * NSEC_PER_SEC)) || result != 0;
                [conn invalidate]; return failed ? 1 : 0;
            }
            if (strcmp(command, "revoke-crash\n") != 0) { stopFixtureBridge(); [conn invalidate]; return 2; }
            stopFixtureBridge();
            result = 1;
            [proxy daemonRevokeAndCrash:reply];
            if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 40 * NSEC_PER_SEC)) == 0 && result != 0) {
                puts("revocation-reply-lost"); fflush(stdout); [conn invalidate]; return 0;
            }
            [conn invalidate]; return 1;
        }
#endif
        if ([mode isEqualToString:@"service-auth-good"] || [mode isEqualToString:@"service-auth-bad"]) [proxy status:reply];
        else if ([mode isEqualToString:@"stop-fixture"]) [proxy stopFixture:reply];
        else if ([mode isEqualToString:@"status"]) [proxy status:reply];
        else if ([mode isEqualToString:@"observe-revocation"]) [proxy observeRevocation:reply];
        else if ([mode isEqualToString:@"crash"]) [proxy crashAfterPending:reply];
        else if ([mode isEqualToString:@"crash-before"]) [proxy crashBeforePending:reply];
        else if ([mode isEqualToString:@"crash-during"]) [proxy crashDuringPending:reply];
#if TURNLINK_VM_DAEMON_FIXTURE
        else if ([mode isEqualToString:@"daemon-revoke-crash"]) [proxy startVM:^(NSString *started) {
            if (![started isEqualToString:@"vm-started-fixture"]) { reply(started); return; }
            [proxy daemonPing:^(NSString *ping) {
                if (![ping isEqualToString:@"daemon-ping-authenticated"]) { reply(ping); return; }
                [proxy daemonWrongKey:^(NSString *wrong) {
                    if (![wrong isEqualToString:@"wrong-key-rejected"]) { reply(wrong); return; }
                    puts("daemon-ping-authenticated wrong-key-rejected"); fflush(stdout);
                    [proxy daemonRevokeAndCrash:reply];
                }];
            }];
        }];
        else if ([mode isEqualToString:@"daemon-recover"]) [proxy startVM:^(NSString *started) {
            if (![started isEqualToString:@"vm-started-fixture"]) { reply(started); return; }
            [proxy daemonRecover:^(NSString *observed) {
                if (![observed isEqualToString:@"guest-revoked-daemon-observed"]) { reply(observed); return; }
                [proxy stopFixture:^(NSString *stopped) { reply([observed stringByAppendingFormat:@" %@", stopped]); }];
            }];
        }];
#endif
        else if ([mode isEqualToString:@"start-pause"]) [proxy startVM:^(NSString *started) {
            if (![started isEqualToString:@"vm-started-fixture"]) { reply(started); return; }
            [proxy pauseVM:^(NSString *paused) { reply([@"vm-started-fixture " stringByAppendingString:paused]); }];
        }];
        else if ([mode isEqualToString:@"start"]) [proxy startVM:reply];
        else if ([mode isEqualToString:@"pause"]) [proxy pauseVM:reply];
        else if ([mode isEqualToString:@"revoke"]) [proxy revoke:reply];
        else return 2;
        dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC));
        [conn invalidate]; return result;
    }
}
