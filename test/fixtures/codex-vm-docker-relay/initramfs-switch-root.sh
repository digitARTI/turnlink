#!/bin/busybox sh
set -eu
/bin/busybox mount -t devtmpfs devtmpfs /dev
exec </dev/console >/dev/console 2>&1
/bin/busybox --install -s /bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mkdir -p /state /newroot
mount -t ext4 /dev/vda /state || { echo TURNLINK_GUEST_DAEMON_FAILED; exit 1; }
mkdir -p /state/turnlink-root
cp -a /bin /etc /lib /usr /root /plugin-image.tar /relay-config.json /secret /init-mounted-root /state/turnlink-root/
mkdir -p /state/turnlink-root/dev /state/turnlink-root/proc /state/turnlink-root/sys /state/turnlink-root/state /state/turnlink-root/run /state/turnlink-root/tmp
mount --bind /state/turnlink-root /newroot
mount --bind /state /newroot/state
mount --move /dev /newroot/dev
mount --move /proc /newroot/proc
mount --move /sys /newroot/sys
exec /bin/busybox switch_root /newroot /init-mounted-root
