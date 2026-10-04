#!/usr/bin/env bash
# Ship what is committed to the server, then read the version back from the live site.   npm run deploy
# Roll back: npm run deploy -- <older commit>
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=${SLOPSTOP_PROJECT:-slopstop-ink}
ZONE=${SLOPSTOP_ZONE:-us-east1-b}
VM=${SLOPSTOP_VM:-slopstop}
REF=${1:-HEAD}
if [ "$REF" = HEAD ] && [ -n "$(git status --porcelain -- src public deploy package.json package-lock.json tsconfig.json)" ]; then
  echo "commit first: deploy ships the last commit, and there are uncommitted changes"
  exit 1
fi
SHA=$(git rev-parse --short "$REF")
TGZ=$(mktemp -d)/slopstop-$SHA.tgz
git archive --format=tar.gz "$SHA" -o "$TGZ"
gcloud compute scp --quiet --project "$PROJECT" --zone "$ZONE" "$TGZ" "$VM:/tmp/"
gcloud compute ssh --quiet --project "$PROJECT" --zone "$ZONE" "$VM" --command "sudo bash -s $SHA" < deploy/release.sh
rm -f "$TGZ"
LIVE=$(curl -fsS https://slopstop.ink/api/health 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)
if [ "$LIVE" = "$SHA" ]; then echo "live: https://slopstop.ink is on $SHA"; else echo "the server restarted on $SHA, but https://slopstop.ink answers '${LIVE:-nothing}' (DNS not pointed yet?)"; fi
