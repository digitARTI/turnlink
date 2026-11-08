#!/bin/busybox sh
/bin/busybox mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
/bin/busybox --install -s /bin
export PATH=/bin:/usr/bin HOME=/root
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t tmpfs tmpfs /run
mkdir -p /sys/fs/cgroup /run/docker-data /run/docker-exec /etc/docker /state
mount -t cgroup2 cgroup2 /sys/fs/cgroup
mount -t ext4 /dev/vda /state || { echo TURNLINK_GUEST_DAEMON_FAILED; exit 1; }
echo 'root:x:0:0:root:/root:/bin/sh' > /etc/passwd
echo 'root:x:0:' > /etc/group
/usr/bin/dockerd --host=unix:///run/docker.sock --data-root=/state/docker-data --exec-root=/run/docker-exec --pidfile=/run/docker.pid --iptables=false --ip6tables=false --bridge=none --ip-forward=false --storage-driver=vfs > /run/dockerd.log 2>&1 &
count=0
while [ "$count" -lt 20 ]; do
  if /usr/bin/docker --host unix:///run/docker.sock version --format '{{.Server.Version}}' >/run/docker-version 2>/run/docker-error; then
    /usr/bin/docker --host unix:///run/docker.sock load --input /alpine.tar >/run/load.log 2>&1 || { echo TURNLINK_GUEST_DAEMON_FAILED; cat /run/load.log; exit 1; }
    exec /usr/bin/turnlink-guest-proxy
  fi
  sleep 1
  count=$((count + 1))
done
echo TURNLINK_GUEST_DAEMON_FAILED
cat /run/dockerd.log
cat /run/docker-error
sleep 5
