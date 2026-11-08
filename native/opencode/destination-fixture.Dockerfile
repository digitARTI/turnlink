# Fixture image: the source images and generated bundle are supplied locally.
# It is not a release artifact and is not an authority or isolation proof.
ARG APP_IMAGE
ARG PLUGIN_IMAGE
FROM ${APP_IMAGE} AS application
FROM ${PLUGIN_IMAGE}
COPY --from=application /usr/local/bin/turnlink-bun /usr/local/bin/turnlink-bun
COPY --from=application /assets/bundle/node_modules /assets/bundle/node_modules
COPY native-live-host.js /assets/bundle/native-recovery-host.js
COPY opencode-destination-observer.mjs /runner.mjs
COPY project /project
USER 10001:10001
