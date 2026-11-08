#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

/* Temporary test binary, not a launcher or a production MCP implementation. */
int main(int argc, char **argv) {
    if (argc == 3 && strcmp(argv[1], "--delegated") == 0) {
        int record = open(argv[2], O_CREAT | O_EXCL | O_WRONLY, 0600);
        if (record < 0) return 1;
        if (dprintf(record, "%d\n", (int)getpid()) < 0 || fsync(record) != 0) return 2;
        close(record); sleep(30); return 0;
    }
    if (argc != 5 || strlen(argv[1]) >= sizeof(((struct sockaddr_un *)0)->sun_path)) return 1;
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return 2;
    struct sockaddr_un address = {0};
    address.sun_family = AF_UNIX;
    strcpy(address.sun_path, argv[1]);
    if (connect(fd, (struct sockaddr *)&address, sizeof(address)) != 0) return 3;
    if (dup2(fd, STDIN_FILENO) < 0 || dup2(fd, STDOUT_FILENO) < 0) return 4;
    if (fd > STDERR_FILENO) close(fd);
    int record = open(argv[2], O_CREAT | O_EXCL | O_WRONLY, 0600);
    if (record < 0) return 5;
    int ready[2];
    if (pipe(ready) != 0) return 6;
    pid_t child = fork();
    if (child < 0) return 7;
    if (child == 0) {
        char approved;
        close(ready[1]);
        if (read(ready[0], &approved, 1) != 1 || approved != '1') _exit(8);
        close(ready[0]);
        if (setsid() < 0) _exit(9);
        close(record); close(STDIN_FILENO); close(STDOUT_FILENO); close(STDERR_FILENO);
        sleep(30); _exit(0);
    }
    close(ready[0]);
    if (dprintf(record, "%d %d\n", (int)getpid(), (int)child) < 0 || fsync(record) != 0) return 10;
    close(record);
    if (write(ready[1], "1", 1) != 1) return 11;
    close(ready[1]);
    char *line = NULL;
    size_t capacity = 0;
    while (getline(&line, &capacity, stdin) >= 0) {
        const char *id = strstr(line, "\"id\":");
        if (id == NULL) continue;
        char *end;
        long identifier = strtol(id + strlen("\"id\":"), &end, 10);
        if (end == id + strlen("\"id\":")) continue;
        if (strstr(line, "\"method\":\"initialize\"")) {
            printf("{\"jsonrpc\":\"2.0\",\"id\":%ld,\"result\":{\"protocolVersion\":\"2025-03-26\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"launchd-fixture\",\"version\":\"1\"}}}\n", identifier);
        } else if (strstr(line, "\"method\":\"tools/list\"")) {
            printf("{\"jsonrpc\":\"2.0\",\"id\":%ld,\"result\":{\"tools\":[{\"name\":\"fixture_echo\",\"inputSchema\":{\"type\":\"object\"}},{\"name\":\"fixture_delegate\",\"inputSchema\":{\"type\":\"object\"}}]}}\n", identifier);
        } else if (strstr(line, "\"method\":\"tools/call\"")) {
            if (strstr(line, "\"fixture_delegate\"")) {
                pid_t delegate = fork();
                if (delegate == 0) {
                    int nullfd = open("/dev/null", O_RDWR);
                    if (nullfd < 0 || dup2(nullfd, 0) < 0 || dup2(nullfd, 1) < 0 || dup2(nullfd, 2) < 0) _exit(12);
                    if (nullfd > 2) close(nullfd);
                    execl("/bin/launchctl", "launchctl", "submit", "-l", argv[3], "--", argv[0], "--delegated", argv[4], (char *)NULL);
                    _exit(13);
                }
                int status = 0;
                if (delegate < 0 || waitpid(delegate, &status, 0) != delegate || !WIFEXITED(status) || WEXITSTATUS(status) != 0) {
                    printf("{\"jsonrpc\":\"2.0\",\"id\":%ld,\"result\":{\"isError\":true,\"content\":[{\"type\":\"text\",\"text\":\"delegation failed\"}]}}\n", identifier);
                } else {
                    printf("{\"jsonrpc\":\"2.0\",\"id\":%ld,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"fixture delegated\"}]}}\n", identifier);
                }
            } else {
                printf("{\"jsonrpc\":\"2.0\",\"id\":%ld,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"fixture result\"}]}}\n", identifier);
            }
        }
        fflush(stdout);
    }
    free(line);
    return 0;
}
