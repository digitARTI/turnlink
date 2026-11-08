#include <errno.h>
#include <stdio.h>
#include <sys/event.h>
#include <unistd.h>

int main(void) {
    int queue = kqueue();
    if (queue < 0) { perror("kqueue"); return 1; }
    struct kevent change, receipt;
    EV_SET(&change, getpid(), EVFILT_PROC, EV_ADD | EV_RECEIPT, NOTE_EXIT, 0, NULL);
    int count = kevent(queue, &change, 1, &receipt, 1, NULL);
    if (count != 1 || !(receipt.flags & EV_ERROR) || receipt.data != 0) return 2;
    close(queue);
    queue = kqueue();
    if (queue < 0) { perror("kqueue"); return 1; }
    EV_SET(&change, getpid(), EVFILT_PROC, EV_ADD | EV_RECEIPT, NOTE_EXIT | NOTE_TRACK, 0, NULL);
    count = kevent(queue, &change, 1, &receipt, 1, NULL);
    if (count != 1 || !(receipt.flags & EV_ERROR)) return 3;
    printf("NOTE_TRACK registration error=%ld ENOTSUP=%d\n", (long)receipt.data, ENOTSUP);
    close(queue);
    return receipt.data == ENOTSUP ? 0 : 4;
}
