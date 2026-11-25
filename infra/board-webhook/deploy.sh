#!/usr/bin/env bash
# Creates or updates the board webhook relay: a Lambda with a public function URL.
# Plain AWS CLI v2, no other tools. Run where `aws` is signed in (AWS CloudShell works).
#
#   bash infra/board-webhook/deploy.sh
#
# First run: asks for the routine's fire URL and token (or reads ROUTINE_FIRE_URL /
# ROUTINE_TOKEN). Later runs update the code and keep the stored fire URL, token and secret;
# set ROUTINE_FIRE_URL or ROUTINE_TOKEN to change one.
# Prints the webhook URL, and the shared secret when it is new.
#
# Optional environment:
#   FUNCTION_NAME          default board-webhook
#   AWS_REGION             default: the CLI's configured region
#   ROTATE_SECRET=1        make a new shared secret even if the function already has one
#   MIN_INTERVAL_SECONDS   default 20 (see handler.js)

set -euo pipefail

FUNCTION_NAME="${FUNCTION_NAME:-board-webhook}"
ROLE_NAME="${FUNCTION_NAME}-role"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

die() { echo "error: $*" >&2; exit 1; }

command -v aws >/dev/null || die "aws CLI not found"
aws sts get-caller-identity >/dev/null || die "aws is not signed in"
REGION="${AWS_REGION:-$(aws configure get region || true)}"
[ -n "$REGION" ] || die "no region: set AWS_REGION"
export AWS_REGION="$REGION" AWS_PAGER=""

exists=0
aws lambda get-function --function-name "$FUNCTION_NAME" >/dev/null 2>&1 && exists=1

# What the function already has, or nothing. Never printed.
stored() {
  [ "$exists" = 1 ] || return 0
  local value
  value="$(aws lambda get-function-configuration --function-name "$FUNCTION_NAME" \
    --query "Environment.Variables.$1" --output text 2>/dev/null || true)"
  [ "$value" = "None" ] || printf '%s' "$value"
}

# --- inputs -------------------------------------------------------------------------------
kept=""
if [ -z "${ROUTINE_FIRE_URL:-}" ]; then
  ROUTINE_FIRE_URL="$(stored ROUTINE_FIRE_URL)"
  [ -z "$ROUTINE_FIRE_URL" ] || kept="fire URL"
fi
if [ -z "${ROUTINE_TOKEN:-}" ]; then
  ROUTINE_TOKEN="$(stored ROUTINE_TOKEN)"
  [ -z "$ROUTINE_TOKEN" ] || kept="${kept:+$kept and }token"
fi
[ -z "$kept" ] || echo "Keeping the stored $kept (set ROUTINE_FIRE_URL / ROUTINE_TOKEN to change)."
if [ -z "${ROUTINE_FIRE_URL:-}" ]; then
  read -r -p "Routine fire URL: " ROUTINE_FIRE_URL
fi
case "$ROUTINE_FIRE_URL" in
  https://api.anthropic.com/v1/claude_code/routines/*/fire) ;;
  *) die "fire URL should look like https://api.anthropic.com/v1/claude_code/routines/<id>/fire" ;;
esac
if [ -z "${ROUTINE_TOKEN:-}" ]; then
  read -r -s -p "Routine token (input hidden): " ROUTINE_TOKEN
  echo
fi
[ -n "$ROUTINE_TOKEN" ] || die "routine token is empty"

new_secret=0
BOARD_SECRET=""
if [ "${ROTATE_SECRET:-0}" != 1 ]; then
  BOARD_SECRET="$(stored BOARD_SECRET)"
fi
if [ -z "$BOARD_SECRET" ]; then
  BOARD_SECRET="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  new_secret=1
fi

# Environment goes through a file so the token never shows up in a process list.
umask 077
cat >"$WORK/env.json" <<EOF
{"Variables":{"BOARD_SECRET":"$BOARD_SECRET","ROUTINE_FIRE_URL":"$ROUTINE_FIRE_URL","ROUTINE_TOKEN":"$ROUTINE_TOKEN","MIN_INTERVAL_SECONDS":"${MIN_INTERVAL_SECONDS:-20}"}}
EOF

# --- package ------------------------------------------------------------------------------
if command -v zip >/dev/null; then
  (cd "$HERE" && zip -q -j "$WORK/function.zip" handler.js)
else
  python3 - "$HERE/handler.js" "$WORK/function.zip" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED) as z:
    z.write(sys.argv[1], "handler.js")
PY
fi

# --- role ---------------------------------------------------------------------------------
if ! ROLE_ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null)"; then
  echo "Creating role $ROLE_NAME"
  cat >"$WORK/trust.json" <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
  ROLE_ARN="$(aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$WORK/trust.json" --query 'Role.Arn' --output text)"
  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "Waiting for the role to propagate"
  sleep 10
fi

# --- function -----------------------------------------------------------------------------
if [ "$exists" = 1 ]; then
  echo "Updating $FUNCTION_NAME"
  aws lambda update-function-code --function-name "$FUNCTION_NAME" \
    --zip-file "fileb://$WORK/function.zip" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME"
  aws lambda update-function-configuration --function-name "$FUNCTION_NAME" \
    --environment "file://$WORK/env.json" >/dev/null
  aws lambda wait function-updated --function-name "$FUNCTION_NAME"
else
  echo "Creating $FUNCTION_NAME"
  for attempt in 1 2 3 4 5; do
    if aws lambda create-function --function-name "$FUNCTION_NAME" \
      --runtime nodejs22.x --handler handler.handler --role "$ROLE_ARN" \
      --timeout 15 --memory-size 128 \
      --environment "file://$WORK/env.json" \
      --zip-file "fileb://$WORK/function.zip" >/dev/null 2>"$WORK/err"; then
      break
    fi
    # A new role can take a little longer to become usable by Lambda.
    grep -q "cannot be assumed" "$WORK/err" && [ "$attempt" -lt 5 ] || { cat "$WORK/err" >&2; exit 1; }
    sleep 5
  done
  aws lambda wait function-active-v2 --function-name "$FUNCTION_NAME"
fi

# --- public URL ---------------------------------------------------------------------------
if ! URL="$(aws lambda get-function-url-config --function-name "$FUNCTION_NAME" \
  --query 'FunctionUrl' --output text 2>/dev/null)"; then
  URL="$(aws lambda create-function-url-config --function-name "$FUNCTION_NAME" \
    --auth-type NONE --query 'FunctionUrl' --output text)"
fi

# A public function URL needs two resource-policy statements: InvokeFunctionUrl, and
# InvokeFunction limited to calls that come through the URL. Without the second the URL
# answers 403. Re-runs find the statements already there.
add_permission() {
  local sid="$1"; shift
  if ! aws lambda add-permission --function-name "$FUNCTION_NAME" --statement-id "$sid" \
    --principal '*' "$@" >/dev/null 2>"$WORK/err"; then
    if grep -q "ResourceConflictException" "$WORK/err"; then return 0; fi
    if grep -qi "unknown options" "$WORK/err"; then
      die "this aws CLI is too old for '$*'. Update AWS CLI v2 and run again."
    fi
    cat "$WORK/err" >&2
    exit 1
  fi
}
add_permission FunctionURLAllowPublicAccess \
  --action lambda:InvokeFunctionUrl --function-url-auth-type NONE
add_permission FunctionURLInvokeAllowPublicAccess \
  --action lambda:InvokeFunction --invoked-via-function-url

# --- smoke test ---------------------------------------------------------------------------
# A wrong secret must be refused with 401. This fires nothing.
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'x-board-secret: wrong' "$URL" || true)"
case "$code" in
  401) echo "Check passed: the URL is reachable and refuses a wrong secret." ;;
  403) echo "warning: the URL answers 403. The function URL permissions are not in place." >&2 ;;
  *)   echo "warning: expected 401 for a wrong secret, got '$code'." >&2 ;;
esac

echo
echo "Webhook URL: $URL"
if [ "$new_secret" = 1 ]; then
  echo "Secret (shown once; put it in Notion as the x-board-secret header): $BOARD_SECRET"
else
  echo "Secret: unchanged (ROTATE_SECRET=1 to make a new one)"
fi
