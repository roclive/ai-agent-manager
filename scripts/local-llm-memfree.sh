#!/bin/sh
# Thin wrapper: see docs/local-llm-memory.md. Usage: local-llm-memfree.sh [--top N] [--stop-service omlx]
cd "$(dirname "$0")/.." && exec npm run --silent aam -- memory "$@"
