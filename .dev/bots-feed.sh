#!/bin/sh
# Keeps the bots agent's simulated chats busy: a few tool events every 30 s. Dev only.
# usage: sh .dev/bots-feed.sh <minutes> <chat ids...>
cd "$(dirname "$0")"
MIN=$1; shift
END=$(( $(date +%s) + MIN * 60 ))
while [ $(date +%s) -lt $END ]; do
  for c in "$@"; do ALPS_URL=http://127.0.0.1:7781/event node sim2.mjs work $c 3 Edit; done
  sleep 30
done
