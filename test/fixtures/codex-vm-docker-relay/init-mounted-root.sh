#!/bin/busybox sh
exec </dev/console >/dev/console 2>&1
export PATH=/bin:/usr/bin HOME=/root
mount -t tmpfs tmpfs /run
mkdir -p /sys/fs/cgroup /run/docker-data /run/docker-exec /etc/docker /state
mount -t cgroup2 cgroup2 /sys/fs/cgroup
echo 'root:x:0:0:root:/root:/bin/sh' > /etc/passwd
echo 'root:x:0:' > /etc/group
/usr/bin/dockerd --host=unix:///run/docker.sock --data-root=/state/docker-data --exec-root=/run/docker-exec --pidfile=/run/docker.pid --iptables=false --ip6tables=false --bridge=none --ip-forward=false --storage-driver=vfs > /run/dockerd.log 2>&1 &
count=0
while [ "$count" -lt 90 ]; do
  if /usr/bin/docker --host unix:///run/docker.sock version --format '{{.Server.Version}}' >/run/docker-version 2>/run/docker-error; then
    /usr/bin/docker --host unix:///run/docker.sock load --input /plugin-image.tar >/run/load.log 2>&1 || { echo TURNLINK_GUEST_DAEMON_FAILED; exit 1; }
    if [ -e /state/docker-relay-config.json ]; then
      cmp -s /relay-config.json /state/docker-relay-config.json || { echo TURNLINK_GUEST_DAEMON_FAILED; exit 1; }
    else
      cp /relay-config.json /state/docker-relay-config.json || exit 1
      sync
    fi
    /usr/local/bin/turnlink-vm-docker-relay /state/docker-relay-config.json /secret > /run/relay.log 2>&1 &
    relay_pid=$!
    wait_count=0
    while ! grep -q TURNLINK_DOCKER_LEASE_LISTENING /run/relay.log; do
      kill -0 "$relay_pid" 2>/dev/null || { echo TURNLINK_GUEST_DAEMON_FAILED; exit 1; }
      [ "$wait_count" -lt 30 ] || { echo TURNLINK_GUEST_DAEMON_FAILED; exit 1; }
      sleep 1
      wait_count=$((wait_count + 1))
    done
    exec /usr/bin/turnlink-guest-proxy
  fi
  sleep 1
  count=$((count + 1))
done
echo TURNLINK_GUEST_DAEMON_FAILED
sleep 5
