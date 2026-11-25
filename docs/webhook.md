# Firing the pickup from the board

Without this, a card waits for the next scheduled pickup run. With it, Notion calls a small relay
when a card moves to `To do` or `Auto-merge` is ticked, and the relay fires the pickup routine
through its API trigger.

```
Notion automation ──POST + x-board-secret──► Lambda function URL ──POST + routine token──► pickup routine
```

The relay passes nothing from Notion on. The routine reads the board itself, so text on a card
cannot reach the routine through this path, and a leaked webhook URL can at most start a pickup
run (which only does what the board already says).

## 1. Get the routine's fire URL and token

Open the pickup routine at [claude.ai/code/routines](https://claude.ai/code/routines) →
**Add another trigger** → **API** → **Generate token**. Copy the URL and the token. The token is
shown once; generating a new one revokes the old one.

## 2. Deploy the relay

Where the AWS CLI v2 is signed in (AWS CloudShell is easiest):

```bash
bash infra/board-webhook/deploy.sh
```

It asks for the fire URL and token, creates (or updates) a Lambda with a public function URL,
checks that the URL refuses a wrong secret, and prints the webhook URL and the shared secret.
The secret is printed only when it is created; `ROTATE_SECRET=1` makes a new one. Running it
again updates the code and keeps the secret.

## 3. Add the Notion automations

Notion database automations need a paid Notion plan. On the board, add two automations:

| When | Action |
|---|---|
| `Status` is set to `To do` | Send webhook → the webhook URL, custom header `x-board-secret: <secret>` |
| `Auto-merge` is checked | the same |

Do not select any properties to send; the relay ignores the body. If a custom header is not
possible in your setup, append `?key=<secret>` to the URL instead (less good: URLs end up in more
logs than headers).

Then slow the pickup's schedule down (every 6 hours is plenty): the schedule is only a safety
net for missed webhooks.

## How the relay behaves

- Wrong or missing secret → `401`. Not `POST` → `405`. Missing settings → `500`.
- Every authenticated call gets `200`, even if the routine could not be fired. Notion pauses an
  automation whose webhook fails, and a rate limit on the routine side should not switch the
  board's automation off. The reason is in the response body and in CloudWatch logs.
- One attempt per call, no retries: the fire endpoint has no idempotency key, so a retry after a
  timeout could start two sessions.
- Calls closer together than `MIN_INTERVAL_SECONDS` (default 20) are dropped. This is best
  effort (per warm Lambda instance); the claim protocol in the pickup routine is what keeps two
  runs from building the same card.
- Routines allow 30 fires per hour per routine. Moving many cards at once is fine: one run
  claims up to `maxInProgress` cards.

## Removing it

```bash
aws lambda delete-function-url-config --function-name board-webhook
aws lambda delete-function --function-name board-webhook
aws iam detach-role-policy --role-name board-webhook-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name board-webhook-role
```

And revoke the routine token by generating a new one.
