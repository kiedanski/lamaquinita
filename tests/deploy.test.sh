#!/usr/bin/env bash
# deploy.sh against stand-in `aws` and `curl` commands. This checks the script's own logic
# (order of calls, idempotence, secret handling); it does not prove the calls work on real AWS.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL deploy: $*" >&2; exit 1; }

mkdir -p "$t/bin"
cat >"$t/bin/aws" <<'STUB'
#!/usr/bin/env bash
# State lives in $STATE: files named after what exists.
echo "aws $*" >>"$STATE/calls"
has() { [ -e "$STATE/$1" ]; }
case "$1 $2" in
  "sts get-caller-identity") echo '{}' ;;
  "configure get") echo us-east-1 ;;
  "lambda get-function") has function || exit 254 ;;
  "lambda get-function-configuration")
    # Answers the one variable --query names, from the environment the last deploy stored.
    var=""; for a in "$@"; do case "$a" in Environment.Variables.*) var="${a#Environment.Variables.}" ;; esac; done
    python3 - "$STATE/env.json" "$var" <<'PY' 2>/dev/null || echo None
import json, sys
print(json.load(open(sys.argv[1]))["Variables"].get(sys.argv[2]) or "None")
PY
    ;;
  "iam get-role") has role || exit 254; echo arn:aws:iam::1:role/r ;;
  "iam create-role") touch "$STATE/role"; echo arn:aws:iam::1:role/r ;;
  "iam attach-role-policy") ;;
  "lambda create-function"|"lambda update-function-configuration")
    touch "$STATE/function"
    for a in "$@"; do case "$a" in file://*) cp "${a#file://}" "$STATE/env.json" ;; esac; done ;;
  "lambda update-function-code") ;;
  "lambda wait") ;;
  "lambda get-function-url-config") has url || exit 254; echo https://abc.lambda-url.us-east-1.on.aws/ ;;
  "lambda create-function-url-config") touch "$STATE/url"; echo https://abc.lambda-url.us-east-1.on.aws/ ;;
  "lambda add-permission")
    if [ -n "${OLD_CLI:-}" ] && [[ "$*" == *--invoked-via-function-url* ]]; then
      echo "Unknown options: --invoked-via-function-url" >&2; exit 252
    fi
    sid=""; prev=""; for a in "$@"; do [ "$prev" = "--statement-id" ] && sid="$a"; prev="$a"; done
    if has "perm-$sid"; then echo "An error occurred (ResourceConflictException)" >&2; exit 254; fi
    touch "$STATE/perm-$sid" ;;
  *) echo "unexpected aws $*" >&2; exit 99 ;;
esac
STUB
cat >"$t/bin/curl" <<'STUB'
#!/usr/bin/env bash
echo 401
STUB
chmod +x "$t/bin/aws" "$t/bin/curl"

run() {
  PATH="$t/bin:$PATH" STATE="$t/state" AWS_REGION=us-east-1 \
    ROUTINE_FIRE_URL="https://api.anthropic.com/v1/claude_code/routines/trig_1/fire" \
    ROUTINE_TOKEN="sk-test" bash "$root/infra/board-webhook/deploy.sh" "$@"
}

# First run: creates everything and prints a new secret.
mkdir -p "$t/state"
out="$(run 2>&1)" || fail "first run failed: $out"
grep -q "Webhook URL: https://abc.lambda-url" <<<"$out" || fail "no URL printed"
secret="$(sed -n 's/^Secret (shown once.*): //p' <<<"$out")"
[ "${#secret}" = 64 ] || fail "expected a 64-hex secret, got '$secret'"
grep -q '"ROUTINE_TOKEN":"sk-test"' "$t/state/env.json" || fail "token not in environment"
grep -q "sk-test" "$t/state/calls" && fail "token appears in aws arguments"
[ -e "$t/state/perm-FunctionURLAllowPublicAccess" ] || fail "InvokeFunctionUrl permission missing"
[ -e "$t/state/perm-FunctionURLInvokeAllowPublicAccess" ] || fail "InvokeFunction permission missing"
grep -q "Check passed" <<<"$out" || fail "smoke check not reported"

# Second run: updates, keeps the secret, tolerates existing permissions.
out="$(run 2>&1)" || fail "second run failed: $out"
grep -q "Secret: unchanged" <<<"$out" || fail "secret should be kept"
grep -q "\"BOARD_SECRET\":\"$secret\"" "$t/state/env.json" || fail "secret changed on update"
grep -q "lambda update-function-code" "$t/state/calls" || fail "code not updated"

# An update with nothing given asks for nothing and keeps the fire URL and the token.
out="$(PATH="$t/bin:$PATH" STATE="$t/state" AWS_REGION=us-east-1 \
  bash "$root/infra/board-webhook/deploy.sh" </dev/null 2>&1)" || fail "update without inputs failed: $out"
grep -q "Keeping the stored fire URL and token" <<<"$out" || fail "did not say it kept them: $out"
grep -q '"ROUTINE_TOKEN":"sk-test"' "$t/state/env.json" || fail "token lost on update"
grep -q 'routines/trig_1/fire' "$t/state/env.json" || fail "fire URL lost on update"
grep -q "\"BOARD_SECRET\":\"$secret\"" "$t/state/env.json" || fail "secret changed on update without inputs"
grep -q "sk-test" <<<"$out" && fail "token printed"

# A new token given on an update replaces the stored one.
out="$(PATH="$t/bin:$PATH" STATE="$t/state" AWS_REGION=us-east-1 ROUTINE_TOKEN=sk-new \
  bash "$root/infra/board-webhook/deploy.sh" </dev/null 2>&1)" || fail "token change failed: $out"
grep -q '"ROUTINE_TOKEN":"sk-new"' "$t/state/env.json" || fail "token not replaced"

# Bad fire URL is refused before touching AWS functions.
if PATH="$t/bin:$PATH" STATE="$t/state" AWS_REGION=us-east-1 ROUTINE_FIRE_URL="https://evil.example/fire" \
  ROUTINE_TOKEN=x bash "$root/infra/board-webhook/deploy.sh" >/dev/null 2>&1; then
  fail "bad fire URL accepted"
fi

# Old CLI without --invoked-via-function-url: clear error.
rm -rf "$t/state"; mkdir -p "$t/state"
if out="$(OLD_CLI=1 run 2>&1)"; then fail "old CLI should fail"; fi
grep -q "too old" <<<"$out" || fail "old CLI message missing: $out"

echo "ok deploy"
