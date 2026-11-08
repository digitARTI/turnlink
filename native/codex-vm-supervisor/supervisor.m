#import "protocol.h"
#if TURNLINK_VM_FIXTURE
#import <Virtualization/Virtualization.h>
#endif
#if TURNLINK_VM_DAEMON_FIXTURE
#include <CommonCrypto/CommonHMAC.h>
#include <sys/socket.h>
#endif
#include <errno.h>
#include <fcntl.h>
#include <sys/acl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

#ifndef TURNLINK_VM_STATE_DIR
#error "A fixed absolute state directory is required"
#endif
#ifndef TURNLINK_VM_FENCE_DIR
#error "A separate fixed absolute fence directory is required"
#endif
#ifndef TURNLINK_VM_EXPECTED_UID
#error "A fixed dedicated non-root UID is required"
#endif
#ifndef TURNLINK_VM_PEER_IDENTIFIER
#error "A fixed peer signing identifier is required"
#endif
#if !TURNLINK_VM_FIXTURE && !defined(TURNLINK_VM_PEER_TEAM)
#error "A fixed Apple developer team identifier is required"
#endif
#ifndef TURNLINK_VM_SERVICE_NAME
#error "A fixed Mach service name is required"
#endif

static int stateFD = -1, fenceFD = -1, lockFD = -1;
static BOOL faulted = NO;
static NSString *peerRequirement;
#if TURNLINK_VM_FIXTURE
static VZVirtualMachine *fixtureVM;
static BOOL fixtureStarting;
#endif
#if TURNLINK_VM_DAEMON_FIXTURE
static NSMutableArray<VZVirtioSocketConnection *> *fixtureStreams;
static BOOL fixtureStreamsClosed;
static void closeFixtureStreams(void) {
    @synchronized (fixtureStreams) {
        fixtureStreamsClosed = YES;
        for (VZVirtioSocketConnection *stream in fixtureStreams) shutdown(stream.fileDescriptor, SHUT_RDWR);
        [fixtureStreams removeAllObjects];
    }
}
static BOOL transfer(int fd, void *buffer, size_t length, BOOL writing) {
    size_t offset = 0;
    while (offset < length) {
        ssize_t count = writing ? write(fd, (char *)buffer + offset, length - offset) : read(fd, (char *)buffer + offset, length - offset);
        if (count <= 0) return NO;
        offset += (size_t)count;
    }
    return YES;
}
static void guestRequest(uint8_t command, int retries, void (^reply)(int)) {
    if (!fixtureVM || !fixtureVM.socketDevices.count || retries <= 0) { reply(-1); return; }
    VZVirtioSocketDevice *device = (VZVirtioSocketDevice *)fixtureVM.socketDevices[0];
    [device connectToPort:4050 completionHandler:^(VZVirtioSocketConnection *connection, NSError *error) {
        if (error || !connection) {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ guestRequest(command, retries - 1, reply); });
            return;
        }
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
            BOOL badKey = command == 'T';
            NSData *key = badKey ? [NSMutableData dataWithLength:32] : [NSData dataWithContentsOfFile:@TURNLINK_VM_KEY];
            uint8_t wireCommand = badKey ? 'B' : command;
            uint8_t nonce[32], frame[65], response[33], expected[32], input[71];
            int fd = connection.fileDescriptor; struct timeval timeout = { .tv_sec = 5, .tv_usec = 0 };
            setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
            int failure = key.length == 32 ? 0 : -11;
            BOOL ok = !failure && transfer(fd, nonce, sizeof(nonce), NO);
            if (!ok && !failure) failure = -12;
            if (ok) {
                memcpy(input, nonce, 32); input[32] = wireCommand; frame[0] = wireCommand;
                arc4random_buf(frame + 33, 32); memcpy(input + 33, frame + 33, 32);
                CCHmac(kCCHmacAlgSHA256, key.bytes, key.length, input, 65, frame + 1);
                ok = transfer(fd, frame, sizeof(frame), YES);
                if (!ok) failure = -13;
                if (ok) { ok = transfer(fd, response, badKey ? 1 : sizeof(response), NO); if (!ok) failure = -14; }
            }
            if (ok && !badKey) {
                memcpy(input + 32, "guest", 5); input[37] = wireCommand; input[38] = response[0];
                memcpy(input + 39, frame + 33, 32);
                CCHmac(kCCHmacAlgSHA256, key.bytes, key.length, input, sizeof(input), expected);
                uint8_t difference = 0; for (int i = 0; i < 32; i++) difference |= expected[i] ^ response[i + 1];
                ok = difference == 0;
                if (!ok) failure = -15;
            }
            int result = ok ? (badKey && response[0] == 'N' ? -2 : response[0]) : failure;
            dispatch_async(dispatch_get_main_queue(), ^{ reply(result); });
        });
    }];
}
#endif
static BOOL validIdentifier(NSString *value) {
    NSCharacterSet *invalid = [[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"] invertedSet];
    return value.length > 0 && [value rangeOfCharacterFromSet:invalid].location == NSNotFound;
}
static BOOL noACL(int fd) {
    errno = 0;
    acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
    if (!acl) return errno == ENOENT;
    acl_entry_t entry;
    int found = acl_get_entry(acl, ACL_FIRST_ENTRY, &entry);
    acl_free(acl);
    return found == 0;
}
static BOOL safeDirectory(int fd, BOOL leaf) {
    struct stat st;
    if (fstat(fd, &st) || !S_ISDIR(st.st_mode) || !noACL(fd)) return NO;
    if (leaf) return st.st_uid == geteuid() && (st.st_mode & 0777) == 0700;
    return st.st_uid == 0 && !(st.st_mode & 0022);
}
static int openDirectory(NSString *path) {
    if (![path hasPrefix:@"/"] || [path containsString:@"//"]) return -1;
    NSArray<NSString *> *parts = path.pathComponents;
    if (parts.count < 2) return -1;
    int current = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (current < 0) return -1;
#if !TURNLINK_VM_FIXTURE
    if (!safeDirectory(current, NO)) { close(current); return -1; }
#endif
    for (NSUInteger i = 1; i < parts.count; i++) {
        NSString *part = parts[i];
        if ([part isEqualToString:@"."] || [part isEqualToString:@".."]) { close(current); return -1; }
        int next = openat(current, part.fileSystemRepresentation, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        close(current); if (next < 0) return -1;
#if TURNLINK_VM_FIXTURE
        if (i == parts.count - 1 && !safeDirectory(next, YES)) { close(next); return -1; }
#else
        if (!safeDirectory(next, i == parts.count - 1)) { close(next); return -1; }
#endif
        current = next;
    }
    return current;
}
static BOOL openOwner(void) {
    if (geteuid() == 0 || geteuid() != (uid_t)TURNLINK_VM_EXPECTED_UID) return NO;
    stateFD = openDirectory(@TURNLINK_VM_STATE_DIR); if (stateFD < 0) return NO;
    fenceFD = openDirectory(@TURNLINK_VM_FENCE_DIR); if (fenceFD < 0) return NO;
    struct stat a, b;
    if (fstat(stateFD, &a) || fstat(fenceFD, &b) || (a.st_dev == b.st_dev && a.st_ino == b.st_ino)) return NO;
    lockFD = openat(stateFD, "owner.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0600);
    struct stat st;
    if (lockFD < 0 || fstat(lockFD, &st) || !S_ISREG(st.st_mode) || st.st_nlink != 1 ||
        st.st_uid != geteuid() || (st.st_mode & 0777) != 0600 || !noACL(lockFD) ||
        flock(lockFD, LOCK_EX | LOCK_NB)) return NO;
    return YES;
}
static BOOL initializeFence(void) {
    int fd = openat(fenceFD, "authority.fence", O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd >= 0) {
        BOOL ok = write(fd, "fenced\n", 7) == 7 && fcntl(fd, F_FULLFSYNC) == 0;
        if (close(fd)) ok = NO;
        if (!ok || fsync(fenceFD)) return NO;
    } else if (errno != EEXIST) return NO;
    fd = openat(fenceFD, "authority.fence", O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) return NO;
    struct stat st; char data[8];
    BOOL ok = !fstat(fd, &st) && S_ISREG(st.st_mode) && st.st_nlink == 1 && st.st_uid == geteuid() &&
        (st.st_mode & 0777) == 0600 && noACL(fd) && read(fd, data, sizeof(data)) == 7 &&
        memcmp(data, "fenced\n", 7) == 0 && fcntl(fd, F_FULLFSYNC) == 0;
    close(fd);
    return ok && fsync(fenceFD) == 0;
}
static NSString *markerState(void) {
    if (faulted) return @"error";
    const char *names[] = {"pending", "revoked"};
    for (int i = 0; i < 2; i++) {
        struct stat st;
        if (fstatat(stateFD, names[i], &st, AT_SYMLINK_NOFOLLOW) == 0) return @"fenced";
        if (errno != ENOENT) return @"error";
    }
    return @"ready-no-dispatch";
}
// Historical observation only. A pending, malformed or replaced record is
// uncertain; neither a missing marker nor this result can open the fence.
static int observeMarker(const char *name) {
    struct stat before, opened, after;
    if (fstatat(stateFD, name, &before, AT_SYMLINK_NOFOLLOW)) return errno == ENOENT ? 0 : -1;
    int fd = openat(stateFD, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) return -1;
    char value[9];
    ssize_t size = read(fd, value, sizeof(value));
    BOOL valid = !fstat(fd, &opened) && S_ISREG(opened.st_mode) && opened.st_nlink == 1 &&
        opened.st_uid == geteuid() && (opened.st_mode & 0777) == 0600 && noACL(fd) &&
        before.st_dev == opened.st_dev && before.st_ino == opened.st_ino &&
        size == 8 && memcmp(value, "revoked\n", 8) == 0 &&
        !fstatat(stateFD, name, &after, AT_SYMLINK_NOFOLLOW) &&
        after.st_dev == opened.st_dev && after.st_ino == opened.st_ino;
    close(fd);
    return valid ? 1 : -1;
}
static BOOL persistPending(void) {
    int fd = openat(stateFD, "pending", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) return NO;
    BOOL ok = write(fd, "revoked\n", 8) == 8 && fcntl(fd, F_FULLFSYNC) == 0;
    if (close(fd)) ok = NO;
    return ok && fsync(stateFD) == 0;
}
@interface Supervisor : NSObject <NSXPCListenerDelegate, TurnlinkVMSupervisor>
@end
@implementation Supervisor
- (BOOL)listener:(NSXPCListener *)listener shouldAcceptNewConnection:(NSXPCConnection *)connection {
    (void)listener;
    [connection setCodeSigningRequirement:peerRequirement];
    connection.exportedInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkVMSupervisor)];
    connection.exportedObject = self;
    [connection activate];
    return YES;
}
- (void)status:(void (^)(NSString *))reply {
    @synchronized (self) { reply([markerState() isEqualToString:@"error"] ? @"error" : @"fenced"); }
}
- (void)observeRevocation:(void (^)(NSString *))reply {
    @synchronized (self) {
        int pending = observeMarker("pending"), revoked = observeMarker("revoked");
        if (faulted || pending < 0 || revoked < 0 || pending == 1) { reply(@"uncertain"); return; }
        reply(revoked == 1 ? @"recorded" : @"no-local-marker");
    }
}
- (void)revoke:(void (^)(NSString *))reply {
    @synchronized (self) {
        if (![markerState() isEqualToString:@"ready-no-dispatch"]) { reply(@"fenced-or-error"); return; }
#if TURNLINK_VM_DAEMON_FIXTURE
        closeFixtureStreams();
#endif
        if (!persistPending()) { faulted = YES; reply(@"fenced-or-error"); return; }
        BOOL ok = renameat(stateFD, "pending", stateFD, "revoked") == 0 && fsync(stateFD) == 0;
        if (!ok) faulted = YES;
        reply(ok ? @"revoked" : @"fenced-or-error");
    }
}
- (void)startVM:(void (^)(NSString *))reply {
#if TURNLINK_VM_FIXTURE
    dispatch_async(dispatch_get_main_queue(), ^{
        if (fixtureVM || fixtureStarting) { reply(@"blocked"); return; }
        fixtureStarting = YES;
        VZVirtualMachineConfiguration *config = [VZVirtualMachineConfiguration new];
        VZLinuxBootLoader *boot = [[VZLinuxBootLoader alloc] initWithKernelURL:[NSURL fileURLWithPath:@TURNLINK_VM_KERNEL]];
        boot.initialRamdiskURL = [NSURL fileURLWithPath:@TURNLINK_VM_INITRD];
        boot.commandLine = @"panic=-1"; config.bootLoader = boot; config.CPUCount = 1; config.memorySize = 512 * 1024 * 1024;
#if TURNLINK_VM_DAEMON_FIXTURE
        fixtureStreams = [NSMutableArray new]; fixtureStreamsClosed = NO;
        config.memorySize = 1024 * 1024 * 1024;
        config.entropyDevices = @[[[VZVirtioEntropyDeviceConfiguration alloc] init]];
        config.socketDevices = @[[[VZVirtioSocketDeviceConfiguration alloc] init]];
        NSError *diskError = nil;
        VZDiskImageStorageDeviceAttachment *disk = [[VZDiskImageStorageDeviceAttachment alloc] initWithURL:[NSURL fileURLWithPath:@TURNLINK_VM_DISK] readOnly:NO error:&diskError];
        if (!disk || diskError) { fixtureStarting = NO; reply(@"vm-disk-unavailable-fixture"); return; }
        config.storageDevices = @[[[VZVirtioBlockDeviceConfiguration alloc] initWithAttachment:disk]];
#endif
        NSError *error = nil;
        if (![config validateWithError:&error]) { fixtureStarting = NO; reply(@"vm-config-invalid-fixture"); return; }
        fixtureVM = [[VZVirtualMachine alloc] initWithConfiguration:config];
        [fixtureVM startWithCompletionHandler:^(NSError *err) {
            fixtureStarting = NO; if (err) { fixtureVM = nil; reply(@"vm-start-failed-fixture"); } else reply(@"vm-started-fixture");
        }];
    });
#else
    reply(@"blocked");
#endif
}
- (void)pauseVM:(void (^)(NSString *))reply {
#if TURNLINK_VM_FIXTURE
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!fixtureVM || !fixtureVM.canPause) { reply(@"blocked"); return; }
#if TURNLINK_VM_DAEMON_FIXTURE
        closeFixtureStreams();
#endif
        [fixtureVM pauseWithCompletionHandler:^(NSError *err) { reply(err ? @"blocked" : @"vm-paused-fixture"); }];
    });
#else
    reply(@"blocked");
#endif
}
#if TURNLINK_VM_FIXTURE
- (void)stopFixture:(void (^)(NSString *))reply {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (fixtureStarting || !fixtureVM || !fixtureVM.canStop) { reply(@"stop-unavailable-fixture"); return; }
#if TURNLINK_VM_DAEMON_FIXTURE
        closeFixtureStreams();
#endif
        [fixtureVM stopWithCompletionHandler:^(NSError *error) {
            if (error) { reply(@"stop-unavailable-fixture"); return; }
            fixtureVM = nil;
            reply([NSString stringWithFormat:@"vm-stopped-fixture %d", getpid()]);
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{ _exit(0); });
        }];
    });
}
#if TURNLINK_VM_DAEMON_FIXTURE
- (void)openFixtureStream:(uint32_t)port reply:(void (^)(NSFileHandle *))reply {
    dispatch_async(dispatch_get_main_queue(), ^{
        if ((port != 4051 && port != 4052 && port != 4053) || !fixtureVM || !fixtureVM.socketDevices.count ||
            ![markerState() isEqualToString:@"ready-no-dispatch"]) { reply(nil); return; }
        @synchronized (fixtureStreams) {
            if (fixtureStreamsClosed || fixtureStreams.count >= 64) { reply(nil); return; }
        }
        VZVirtualMachine *owner = fixtureVM;
        VZVirtioSocketDevice *device = (VZVirtioSocketDevice *)owner.socketDevices[0];
        [device connectToPort:port completionHandler:^(VZVirtioSocketConnection *connection, NSError *error) {
            @synchronized (fixtureStreams) {
                if (error || !connection || fixtureStreamsClosed || fixtureVM != owner || fixtureStreams.count >= 64 ||
                    ![markerState() isEqualToString:@"ready-no-dispatch"]) { reply(nil); return; }
                int fd = fcntl(connection.fileDescriptor, F_DUPFD_CLOEXEC, 3);
                if (fd < 0) { reply(nil); return; }
                [fixtureStreams addObject:connection];
                reply([[NSFileHandle alloc] initWithFileDescriptor:fd closeOnDealloc:YES]);
            }
        }];
    });
}
- (void)daemonPing:(void (^)(NSString *))reply {
    dispatch_async(dispatch_get_main_queue(), ^{ guestRequest('B', 360, ^(int result) { reply(result == 'P' ? @"daemon-ping-authenticated" : [NSString stringWithFormat:@"daemon-ping-failed-fixture-%d", result]); }); });
}
- (void)daemonWrongKey:(void (^)(NSString *))reply {
    dispatch_async(dispatch_get_main_queue(), ^{ guestRequest('T', 120, ^(int result) { reply(result == -2 ? @"wrong-key-rejected" : @"wrong-key-test-failed-fixture"); }); });
}
- (void)daemonRevokeAndCrash:(void (^)(NSString *))reply {
    dispatch_async(dispatch_get_main_queue(), ^{ closeFixtureStreams(); guestRequest('Y', 120, ^(int result) {
        if (result == 'R') _exit(81);
        reply(@"blocked");
    }); });
}
- (void)daemonRecover:(void (^)(NSString *))reply {
    dispatch_async(dispatch_get_main_queue(), ^{ guestRequest('Z', 120, ^(int inspect) {
        if (inspect != 'I' && inspect != 'Y') { reply(@"blocked"); return; }
        guestRequest('B', 120, ^(int ping) { reply(ping == 'N' ? @"guest-revoked-daemon-observed" : @"blocked"); });
    }); });
}
#endif
- (void)crashBeforePending:(void (^)(NSString *))reply { (void)reply; _exit(76); }
- (void)crashDuringPending:(void (^)(NSString *))reply {
    (void)reply;
    int fd = openat(stateFD, "pending", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) _exit(78);
    if (write(fd, "r", 1) != 1) _exit(79);
    _exit(80); // Before the pending record or directory is synced.
}
- (void)crashAfterPending:(void (^)(NSString *))reply {
    @synchronized (self) {
        if (![markerState() isEqualToString:@"ready-no-dispatch"] || !persistPending()) { reply(@"fenced-or-error"); return; }
        _exit(77);
    }
}
#endif
@end
int main(int argc, const char **argv) {
    @autoreleasepool {
        NSString *identifier = @TURNLINK_VM_PEER_IDENTIFIER;
        if (!validIdentifier(identifier)) return 3;
#if TURNLINK_VM_FIXTURE
        peerRequirement = [NSString stringWithFormat:@"identifier \"%@\"", identifier];
#else
        NSString *team = @TURNLINK_VM_PEER_TEAM;
        NSCharacterSet *badTeam = [[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"] invertedSet];
        if (team.length != 10 || [team rangeOfCharacterFromSet:badTeam].location != NSNotFound) return 3;
        peerRequirement = [NSString stringWithFormat:@"anchor apple generic and identifier \"%@\" and certificate leaf[subject.OU] = \"%@\"", identifier, team];
#endif
        if (!openOwner() || !initializeFence()) return 4;
#if TURNLINK_VM_FIXTURE
        if (argc == 2 && strcmp(argv[1], "--hold-owner") == 0) {
            puts("owner-held"); fflush(stdout); pause(); return 0;
        }
        NSXPCListener *listener = [NSXPCListener serviceListener];
#else
        (void)argc; (void)argv;
        NSXPCListener *listener = [[NSXPCListener alloc] initWithMachServiceName:@TURNLINK_VM_SERVICE_NAME];
#endif
        Supervisor *owner = [Supervisor new]; listener.delegate = owner;
        [listener resume];
#if !TURNLINK_VM_FIXTURE
        dispatch_main();
#endif
    }
    return 0;
}
