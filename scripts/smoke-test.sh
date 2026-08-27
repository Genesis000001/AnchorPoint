#!/usr/bin/env bash
#
# Synthetic smoke tests for production endpoint monitoring.
# Verifies core health, SEP-1 TOML, SEP-10 challenge, and /info flows.
#
# Usage:
#   TARGET_HOST=https://api.example.com ./scripts/smoke-test.sh
#
# Environment:
#   TARGET_HOST          Required (falls back to BASE_URL). API origin or host.
#   SMOKE_TEST_ACCOUNT   Optional Stellar public key used for GET /auth.
#   SMOKE_TEST_CONNECT_TIMEOUT  Optional curl connect timeout (default 10s).
#   SMOKE_TEST_MAX_TIME         Optional curl max time (default 30s).
#
# Exit codes:
#   0  all checks passed
#   1  one or more checks failed, or required configuration is missing

set -euo pipefail

TARGET_HOST="${TARGET_HOST:-${BASE_URL:-}}"
SMOKE_TEST_ACCOUNT="${SMOKE_TEST_ACCOUNT:-GB7KUA47QKRI6Q6X7C3HOC2HEP6VJQRQWQYQF66VJPHJRVMEDJOVML6K}"
CONNECT_TIMEOUT="${SMOKE_TEST_CONNECT_TIMEOUT:-10}"
MAX_TIME="${SMOKE_TEST_MAX_TIME:-30}"
FAILURES=0

if [[ -z "$TARGET_HOST" ]]; then
  printf '[smoke-test][ERROR] TARGET_HOST must be set.\n' >&2
  exit 1
fi

if [[ ! "$SMOKE_TEST_ACCOUNT" =~ ^G[A-Z2-7]{55}$ ]]; then
  printf '[smoke-test][ERROR] SMOKE_TEST_ACCOUNT must be a valid Stellar public key.\n' >&2
  exit 1
fi

# Allow a bare host (api.example.com) or a full origin (https://api.example.com).
if [[ ! "$TARGET_HOST" =~ ^https?:// ]]; then
  TARGET_HOST="https://${TARGET_HOST}"
fi

TARGET_HOST="${TARGET_HOST%/}"

check_endpoint() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local status
  local -a curl_args=(
    --silent
    --show-error
    --output /dev/null
    --write-out '%{http_code}'
    --connect-timeout "$CONNECT_TIMEOUT"
    --max-time "$MAX_TIME"
    --request "$method"
  )

  if [[ -n "$body" ]]; then
    curl_args+=(--header 'Content-Type: application/json' --data "$body")
  fi

  if ! status="$(curl "${curl_args[@]}" "${TARGET_HOST}${path}")"; then
    printf '[smoke-test][FAIL] %s %s (request failed)\n' "$method" "$path" >&2
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  if [[ "$status" != "200" ]]; then
    printf '[smoke-test][FAIL] %s %s (HTTP %s)\n' "$method" "$path" "$status" >&2
    FAILURES=$((FAILURES + 1))
    return 0
  fi

  printf '[smoke-test][PASS] %s %s (HTTP 200)\n' "$method" "$path"
}

check_endpoint GET '/health'
check_endpoint GET '/.well-known/stellar.toml'
check_endpoint GET "/auth?account=${SMOKE_TEST_ACCOUNT}"
check_endpoint GET '/info'
check_endpoint POST '/sep10' "{\"account\":\"${SMOKE_TEST_ACCOUNT}\"}"
check_endpoint GET '/sep24/info'
check_endpoint GET '/sep38/info'

if [[ "$FAILURES" -gt 0 ]]; then
  printf '[smoke-test][ERROR] %s endpoint check(s) failed.\n' "$FAILURES" >&2
  exit 1
fi

printf '[smoke-test] All endpoint checks passed.\n'
exit 0
