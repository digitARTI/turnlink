ARG BASE_IMAGE
FROM ${BASE_IMAGE} AS source
FROM scratch
COPY --from=source /lib/aarch64-linux-gnu/ld-linux-aarch64.so.1 /lib/aarch64-linux-gnu/ld-linux-aarch64.so.1
COPY --from=source /lib/aarch64-linux-gnu/libc.so.6 /lib/aarch64-linux-gnu/libc.so.6
COPY --from=source /lib/aarch64-linux-gnu/libdl.so.2 /lib/aarch64-linux-gnu/libdl.so.2
COPY --from=source /lib/aarch64-linux-gnu/libgcc_s.so.1 /lib/aarch64-linux-gnu/libgcc_s.so.1
COPY --from=source /lib/aarch64-linux-gnu/libm.so.6 /lib/aarch64-linux-gnu/libm.so.6
COPY --from=source /lib/aarch64-linux-gnu/libpthread.so.0 /lib/aarch64-linux-gnu/libpthread.so.0
COPY --from=source /lib/aarch64-linux-gnu/libstdc++.so.6 /lib/aarch64-linux-gnu/libstdc++.so.6
COPY --from=source /lib/aarch64-linux-gnu/libstdc++.so.6.0.33 /lib/aarch64-linux-gnu/libstdc++.so.6.0.33
COPY --from=source /lib/ld-linux-aarch64.so.1 /lib/ld-linux-aarch64.so.1
COPY --from=source /usr/bin/env /usr/bin/env
COPY --from=source /usr/local/bin/turnlink-node /usr/local/bin/turnlink-node
COPY --from=source /sealed /sealed
COPY plugin-slim.passwd /etc/passwd
USER 10001:10001
