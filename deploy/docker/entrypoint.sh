#!/bin/sh
set -eu
umask 077
mkdir -p "$HOME/.claude" "$HOME/.cache"
exec "$@"
