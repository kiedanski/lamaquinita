// Board webhook relay: an AWS Lambda behind a function URL.
//
// Notion's "Send webhook" automation calls this URL when a card changes. The relay checks a
// shared secret and then fires the board-pickup routine through its API trigger. The one thing it
// passes on from Notion is the id of the card that changed, and only when it is 32 hex digits:
// the run looks at that card first, so cards moved together are not all left to one run. Card
// text never reaches the routine through this path.
//
// Environment:
//   BOARD_SECRET           shared secret; sent by Notion as the x-board-secret header (or ?key=)
//   ROUTINE_FIRE_URL       the routine's fire URL (https://api.anthropic.com/v1/claude_code/routines/<id>/fire)
//   ROUTINE_TOKEN          the routine's API-trigger token
//   MIN_INTERVAL_SECONDS   optional, default 20: a second fire for the same card closer than this
//                          is dropped (best effort, per warm Lambda instance). Calls that name
//                          no card count as one card.
//   ANTHROPIC_VERSION      optional, default 2023-06-01
//   ANTHROPIC_BETA         optional, default experimental-cc-routine-2026-04-01 (the header the
//                          fire endpoint ships under)
//
// Answers: 405 for anything but POST, 401 for a wrong secret, 500 if not configured, and 200 for
// every authenticated call, whether or not the routine was fired. Notion pauses an automation
// whose webhook fails, so a rate limit or an outage on the routine side must not look like a
// failure to Notion; the reason is in the body and in the logs.

'use strict';

const crypto = require('node:crypto');

const PAGE_ID_RE = /^[0-9a-f]{32}$/;
// Bounds the per-card memory of a warm instance that sees many cards.
const MAX_REMEMBERED_CARDS = 500;
const FIRE_TIMEOUT_MS = 10000;

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function secretMatches(given, expected) {
  if (typeof given !== 'string' || given.length === 0) return false;
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

function headerValue(headers, name) {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

// Notion's "Send webhook" action posts the page as `data` ({ object: 'page', id, properties }).
function cardOf(event) {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
    const id = String(JSON.parse(raw || '{}').data.id).replace(/-/g, '').toLowerCase();
    return PAGE_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

function fireText(card) {
  return JSON.stringify(card ? { source: 'board-webhook', card } : { source: 'board-webhook' });
}

function reply(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

function createHandler({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now, log = console } = {}) {
  const lastFireAt = new Map();

  return async function handler(event = {}) {
    const method = event.requestContext?.http?.method ?? event.httpMethod;
    if (method !== 'POST') return reply(405, { error: 'POST only' });

    const { BOARD_SECRET, ROUTINE_FIRE_URL, ROUTINE_TOKEN } = env;
    if (!BOARD_SECRET || !ROUTINE_FIRE_URL || !ROUTINE_TOKEN) {
      log.error('relay is not configured: BOARD_SECRET, ROUTINE_FIRE_URL and ROUTINE_TOKEN are required');
      return reply(500, { error: 'not configured' });
    }

    const given = headerValue(event.headers, 'x-board-secret') ?? event.queryStringParameters?.key;
    if (!secretMatches(given, BOARD_SECRET)) return reply(401, { error: 'unauthorized' });

    const card = cardOf(event);
    const minIntervalMs = 1000 * Number(env.MIN_INTERVAL_SECONDS ?? 20);
    const t = now();
    const key = card ?? '';
    if (t - (lastFireAt.get(key) ?? -Infinity) < minIntervalMs) {
      log.info('not fired: debounced');
      return reply(200, { fired: false, reason: 'debounced' });
    }
    if (lastFireAt.size >= MAX_REMEMBERED_CARDS) lastFireAt.clear();
    lastFireAt.set(key, t);

    // One attempt only. The fire endpoint has no idempotency key, so a retry after a timeout can
    // start a second session. The next card change or the schedule picks up anything missed.
    try {
      const res = await fetchImpl(ROUTINE_FIRE_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ROUTINE_TOKEN}`,
          'anthropic-version': env.ANTHROPIC_VERSION || '2023-06-01',
          'anthropic-beta': env.ANTHROPIC_BETA || 'experimental-cc-routine-2026-04-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: fireText(card) }),
        signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
      });
      if (!res.ok) {
        log.error(`not fired: routine answered ${res.status}`);
        return reply(200, { fired: false, reason: `routine answered ${res.status}` });
      }
      const body = await res.json().catch(() => ({}));
      log.info(`fired: ${body.claude_code_session_url ?? 'session created'}`);
      return reply(200, { fired: true, session: body.claude_code_session_url ?? null });
    } catch (err) {
      log.error(`not fired: ${err.name}: ${err.message}`);
      return reply(200, { fired: false, reason: 'routine unreachable' });
    }
  };
}

module.exports = { handler: createHandler(), createHandler, secretMatches, cardOf };
