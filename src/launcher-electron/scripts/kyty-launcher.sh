#!/bin/sh
# Starts the KytyPS5 launcher. Chromium's sandbox needs unprivileged user namespaces; where the
# system restricts them (Ubuntu 24.04 AppArmor, some Debian kernels) and chrome-sandbox is not
# setuid root, start without it.
DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$DIR/launcher-electron"
SANDBOX_ARGS=""
if [ ! -u "$APP_DIR/chrome-sandbox" ]; then
	if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] ||
		[ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = "0" ] ||
		[ "$(id -u)" = "0" ]; then
		SANDBOX_ARGS="--no-sandbox"
	fi
fi
exec "$APP_DIR/kyty-launcher" $SANDBOX_ARGS "$@"
