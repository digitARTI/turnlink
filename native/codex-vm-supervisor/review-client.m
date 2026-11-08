#import "protocol.h"
#include <stdio.h>

#ifndef TURNLINK_VM_SERVICE_NAME
#error "A fixed Mach service name is required"
#endif
#ifndef TURNLINK_VM_SERVICE_IDENTIFIER
#error "A fixed service signing identifier is required"
#endif
#ifndef TURNLINK_VM_SERVICE_TEAM
#error "A fixed service signing team is required"
#endif

// Review-only status client. It authenticates each XPC connection but has no
// authority to start a VM, dispatch an effect, or release a receiver.
static BOOL validIdentifier(NSString *value) {
    NSCharacterSet *invalid = [[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-"] invertedSet];
    return value.length > 0 && [value rangeOfCharacterFromSet:invalid].location == NSNotFound;
}
int main(int argc, const char **argv) {
    @autoreleasepool {
        if (argc != 2) return 2;
        NSString *mode = [NSString stringWithUTF8String:argv[1]], *service = @TURNLINK_VM_SERVICE_NAME;
        NSString *identifier = @TURNLINK_VM_SERVICE_IDENTIFIER, *team = @TURNLINK_VM_SERVICE_TEAM;
        if (!validIdentifier(service) || !validIdentifier(identifier) || team.length != 10 ||
            [team rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"] invertedSet]].location != NSNotFound ||
            !([mode isEqualToString:@"status"] || [mode isEqualToString:@"observe-revocation"])) return 2;
        NSString *requirement = [NSString stringWithFormat:@"anchor apple generic and identifier \"%@\" and certificate leaf[subject.OU] = \"%@\"", identifier, team];
        NSXPCConnection *conn = [[NSXPCConnection alloc] initWithMachServiceName:service options:NSXPCConnectionPrivileged];
        conn.remoteObjectInterface = [NSXPCInterface interfaceWithProtocol:@protocol(TurnlinkVMSupervisor)];
        [conn setCodeSigningRequirement:requirement];
        [conn activate];
        dispatch_semaphore_t done = dispatch_semaphore_create(0); __block int result = 1;
        id<TurnlinkVMSupervisor> proxy = [conn remoteObjectProxyWithErrorHandler:^(NSError *error) {
            (void)error; dispatch_semaphore_signal(done);
        }];
        void (^reply)(NSString *) = ^(NSString *value) {
            NSSet *allowed = [mode isEqualToString:@"status"] ? [NSSet setWithArray:@[@"fenced", @"error"]] :
                [NSSet setWithArray:@[@"recorded", @"uncertain", @"no-local-marker"]];
            if ([allowed containsObject:value]) { puts(value.UTF8String); result = 0; }
            dispatch_semaphore_signal(done);
        };
        if ([mode isEqualToString:@"status"]) [proxy status:reply]; else [proxy observeRevocation:reply];
        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC))) result = 1;
        [conn invalidate]; return result;
    }
}
