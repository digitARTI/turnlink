# Experimental runtime-only test image. Verify the local base image ID before
# building; see container-runtime.md. No project files or credentials are copied.
FROM jarvis-suite:local
COPY --chmod=0555 node /usr/local/bin/turnlink-node
COPY --chmod=0555 bun /usr/local/bin/turnlink-bun
ENTRYPOINT ["/usr/local/bin/turnlink-bun"]
