#!/usr/bin/env bash
# Dev wrapper that clears Anthropic-related env vars set by Claude Desktop
# (which exports an empty ANTHROPIC_API_KEY into the user's launchd env,
# overriding .env.local in both Node --env-file and Next.js).
#
# Safe to run from anywhere; only this script's subshell is affected.

unset ANTHROPIC_API_KEY
unset ANTHROPIC_BASE_URL
unset ANTHROPIC_MODEL

exec npx next dev "$@"
