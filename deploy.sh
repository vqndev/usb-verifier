#!/usr/bin/env bash
set -e
ssh fun "set -e && cd /srv/usb-verifier && git pull --ff-only && npm ci && npm run build"
echo "Live: https://usb.vqn.dev"
