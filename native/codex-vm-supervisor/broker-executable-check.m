#import "broker-executable-check.h"
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/acl.h>
#include <sys/stat.h>
#include <unistd.h>

static BOOL noACL(int fd) {
    errno = 0; acl_t acl = acl_get_fd_np(fd, ACL_TYPE_EXTENDED);
    if (!acl) return errno == ENOENT;
    acl_entry_t entry; int result = acl_get_entry(acl, ACL_FIRST_ENTRY, &entry); acl_free(acl); return result == 0;
}
static BOOL safeID(NSString *value) {
    NSCharacterSet *bad = [[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"] invertedSet];
    return value.length > 0 && [value rangeOfCharacterFromSet:bad].location == NSNotFound;
}
BOOL TurnlinkVerifyBrokerExecutable(NSString *path, NSString *identifier, NSString *team, NSString *hash) {
    NSCharacterSet *badTeam = [[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"] invertedSet];
    NSCharacterSet *badHex = [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"] invertedSet];
    if (![path hasPrefix:@"/"] || [path containsString:@"//"] || path.pathComponents.count < 2 || !safeID(identifier) ||
        team.length != 10 || [team rangeOfCharacterFromSet:badTeam].location != NSNotFound || hash.length != 64 ||
        [hash rangeOfCharacterFromSet:badHex].location != NSNotFound) return NO;
    int fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC); if (fd < 0) return NO;
    NSArray<NSString *> *parts = path.pathComponents; struct stat st;
    for (NSUInteger i = 0; i < parts.count; i++) {
        if (i) {
            NSString *part = parts[i]; if ([part isEqualToString:@"."] || [part isEqualToString:@".."]) { close(fd); return NO; }
            int flags = O_RDONLY | O_NOFOLLOW | O_CLOEXEC | (i == parts.count - 1 ? 0 : O_DIRECTORY);
            int next = openat(fd, part.fileSystemRepresentation, flags); close(fd); fd = next; if (fd < 0) return NO;
        }
        BOOL leaf = i == parts.count - 1;
        if (fstat(fd, &st) || (leaf ? !S_ISREG(st.st_mode) || st.st_nlink != 1 : !S_ISDIR(st.st_mode)) ||
            st.st_uid != 0 || (st.st_mode & 0022) || !noACL(fd)) { close(fd); return NO; }
    }
    CC_SHA256_CTX ctx; CC_SHA256_Init(&ctx); uint8_t buffer[65536]; ssize_t count;
    while ((count = read(fd, buffer, sizeof(buffer))) > 0) CC_SHA256_Update(&ctx, buffer, (CC_LONG)count);
    if (count < 0) { close(fd); return NO; }
    uint8_t sum[CC_SHA256_DIGEST_LENGTH]; CC_SHA256_Final(sum, &ctx);
    NSMutableString *actual = [NSMutableString stringWithCapacity:64];
    for (NSUInteger i = 0; i < sizeof(sum); i++) [actual appendFormat:@"%02x", sum[i]];
    if (![actual isEqualToString:hash]) { close(fd); return NO; }
    NSString *text = [NSString stringWithFormat:@"anchor apple generic and identifier \"%@\" and certificate leaf[subject.OU] = \"%@\"", identifier, team];
    SecStaticCodeRef code = NULL; SecRequirementRef requirement = NULL; CFDictionaryRef info = NULL;
    BOOL valid = SecStaticCodeCreateWithPath((__bridge CFURLRef)[NSURL fileURLWithPath:path], kSecCSDefaultFlags, &code) == errSecSuccess &&
        SecRequirementCreateWithString((__bridge CFStringRef)text, kSecCSDefaultFlags, &requirement) == errSecSuccess &&
        SecStaticCodeCheckValidity(code, kSecCSStrictValidate | kSecCSCheckAllArchitectures, requirement) == errSecSuccess &&
        SecCodeCopySigningInformation(code, kSecCSSigningInformation, &info) == errSecSuccess;
    if (valid) {
        CFNumberRef flags = CFDictionaryGetValue(info, kSecCodeInfoFlags); uint32_t value = 0;
        valid = flags && CFGetTypeID(flags) == CFNumberGetTypeID() && CFNumberGetValue(flags, kCFNumberSInt32Type, &value) &&
            (value & kSecCodeSignatureRuntime) != 0;
    }
    struct stat finalFD, finalPath;
    valid = valid && !fstat(fd, &finalFD) && !lstat(path.fileSystemRepresentation, &finalPath) &&
        finalFD.st_dev == st.st_dev && finalFD.st_ino == st.st_ino && finalPath.st_dev == st.st_dev && finalPath.st_ino == st.st_ino;
    if (info) CFRelease(info); if (requirement) CFRelease(requirement); if (code) CFRelease(code); close(fd);
    return valid;
}
