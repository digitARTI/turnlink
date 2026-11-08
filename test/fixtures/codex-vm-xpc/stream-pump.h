#pragma once
#include <errno.h>
#include <sys/socket.h>
#include <unistd.h>

// Propagate a clean EOF only to the peer's write side. A failure must unblock
// both pumps; the supervisor can also revoke both sockets independently.
static int turnlinkPump(int source, int target) {
    char bytes[16384];
    for (;;) {
        ssize_t count = read(source, bytes, sizeof(bytes));
        if (count == 0) { shutdown(target, SHUT_WR); return 0; }
        if (count < 0) { if (errno == EINTR) continue; break; }
        ssize_t offset = 0;
        while (offset < count) {
            ssize_t written = write(target, bytes + offset, (size_t)(count - offset));
            if (written < 0 && errno == EINTR) continue;
            if (written <= 0) goto failed;
            offset += written;
        }
    }
failed:
    shutdown(source, SHUT_RDWR); shutdown(target, SHUT_RDWR); return -1;
}
