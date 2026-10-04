#!/usr/bin/env bash
# On the server, as root (deploy.sh pipes this in): unpack a release, install, switch to it, restart, wait for health.
set -euo pipefail
SHA=$1
DIR=/opt/slopstop/releases/$SHA
rm -rf "$DIR" && mkdir -p "$DIR"
tar -xzf "/tmp/slopstop-$SHA.tgz" -C "$DIR" && rm -f "/tmp/slopstop-$SHA.tgz"
echo "APP_VERSION=$SHA" > "$DIR/.release"
(cd "$DIR" && PATH=/opt/node/bin:$PATH npm ci --no-audit --no-fund --loglevel=error)
install -m 644 "$DIR/deploy/slopstop.service" /etc/systemd/system/slopstop.service
install -m 644 "$DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
ln -sfn "$DIR" /opt/slopstop/current
systemctl daemon-reload
systemctl enable --quiet slopstop caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy
systemctl restart slopstop
# Keep the last three releases for a quick roll back.
ls -1dt /opt/slopstop/releases/* | tail -n +4 | xargs -r rm -rf
for _ in $(seq 1 60); do
  if curl -fs http://127.0.0.1:1290/api/health; then echo; exit 0; fi
  sleep 1
done
journalctl -u slopstop -n 60 --no-pager
exit 1
