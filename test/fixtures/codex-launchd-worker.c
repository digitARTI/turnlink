#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc != 2) return 1;
    int fd = open(argv[1], O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (fd < 0) return 2;
    pid_t child = fork();
    if (child < 0) return 3;
    if (child == 0) {
        setsid(); close(fd); close(0); close(1); close(2);
        sleep(25); _exit(0);
    }
    dprintf(fd, "%d %d\n", (int)getpid(), (int)child);
    close(fd);
    sleep(25);
    return 0;
}
