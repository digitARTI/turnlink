#include "stream-pump.h"
#include <pthread.h>
#include <signal.h>
#include <string.h>

struct pair { int source; int target; };
static void *run(void *value) { struct pair *p = value; turnlinkPump(p->source, p->target); return NULL; }
static int readExact(int fd, char *buffer, size_t length) {
    size_t offset = 0;
    while (offset < length) { ssize_t n = read(fd, buffer + offset, length - offset); if (n <= 0) return -1; offset += (size_t)n; }
    return 0;
}

int main(void) {
    signal(SIGPIPE, SIG_IGN);
    int left[2], right[2];
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, left) || socketpair(AF_UNIX, SOCK_STREAM, 0, right)) return 1;
    struct pair a = { left[1], right[0] }, b = { right[0], left[1] };
    pthread_t first, second;
    if (pthread_create(&first, NULL, run, &a) || pthread_create(&second, NULL, run, &b)) return 2;
    if (write(left[0], "request", 7) != 7 || shutdown(left[0], SHUT_WR)) return 3;
    char input[8] = {0};
    if (readExact(right[1], input, 7) || memcmp(input, "request", 7) || read(right[1], input, 1) != 0) return 4;
    if (write(right[1], "response", 8) != 8 || shutdown(right[1], SHUT_WR)) return 5;
    char output[9] = {0};
    if (readExact(left[0], output, 8) || memcmp(output, "response", 8) || read(left[0], output, 1) != 0) return 6;
    pthread_join(first, NULL); pthread_join(second, NULL);
    close(left[0]); close(left[1]); close(right[0]); close(right[1]);
    if (socketpair(AF_UNIX, SOCK_STREAM, 0, left) || socketpair(AF_UNIX, SOCK_STREAM, 0, right)) return 7;
    a = (struct pair){ left[1], right[0] }; b = (struct pair){ right[0], left[1] };
    if (pthread_create(&first, NULL, run, &a) || pthread_create(&second, NULL, run, &b)) return 8;
    shutdown(left[1], SHUT_RDWR); shutdown(right[0], SHUT_RDWR);
    pthread_join(first, NULL); pthread_join(second, NULL);
    close(left[0]); close(left[1]); close(right[0]); close(right[1]);
    return 0;
}
