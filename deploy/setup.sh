#!/usr/bin/env bash
# Once, on a fresh Debian 12 server, as root: swap, Chromium for the decks, Node, Caddy for HTTPS, a service user.
set -euo pipefail
NODE_VERSION=22.22.2

# Chrome printing a deck next to the agent can brush past 1 GB on the smallest machine.
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q chromium fonts-liberation2 fonts-urw-base35 fonts-dejavu-core curl xz-utils gnupg \
  debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades

if [ "$(/opt/node/bin/node -v 2>/dev/null)" != "v$NODE_VERSION" ]; then
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" -o /tmp/node.tar.xz
  rm -rf /opt/node && mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1 && rm /tmp/node.tar.xz
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

id slopstop >/dev/null 2>&1 || useradd --system --home /var/lib/slopstop --create-home --shell /usr/sbin/nologin slopstop
mkdir -p /opt/slopstop/releases /etc/slopstop /var/lib/slopstop/decks
chown -R slopstop:slopstop /var/lib/slopstop
chmod 700 /etc/slopstop
echo "setup done: node $(/opt/node/bin/node -v), $(chromium --version 2>/dev/null), $(caddy version | cut -d' ' -f1)"
