#!/bin/sh
set -eu
umask 077
mkdir -p "$HOME/.claude" "$HOME/.cache"
if [ -f /run/secrets/model-token ]; then
  THREADBEAR_MODEL_TOKEN=$(cat /run/secrets/model-token)
  export THREADBEAR_MODEL_TOKEN
fi
exec "$@"
