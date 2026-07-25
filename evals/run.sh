#!/usr/bin/env bash
# Compatibility shim — the eval runner is evals/run.ts (model matrix, repeats,
# graded scoring, cost telemetry). Every flag is forwarded:
#
#   ./evals/run.sh --suite full --models opus,sonnet,haiku --repeats 3
#
# See evals/README.md.
set -euo pipefail
exec bun run "$(cd "$(dirname "$0")" && pwd)/run.ts" "$@"
