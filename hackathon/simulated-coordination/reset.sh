#!/bin/sh
set -eu
port="${PUFF_SIM_PORT:-4187}"
exec curl --fail --silent --show-error --user alice:demo-alice \
  --request POST "http://127.0.0.1:${port}/api/coordination/v1/simulation/reset"
