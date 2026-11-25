# Design notes

## Why the rules are where they are

- **The instructions live in the project repo**, not in the routine's prompt. The prompt only
  says which file to follow, so changing how agents work is a reviewed PR like any other change.
- **poteto-mode for every card.** The board-loop skill asks for it explicitly rather than relying
  on pstack's routing hook, and a session without pstack blocks the card instead of quietly
  building it another way. `workflow.pstack: false` turns this off.
- **A person merges.** The only ways to merge are a GitHub approval, a person saying "merge" in a
  session, or a person ticking `Auto-merge`. Agents never tick it.
- **Card ids, not URLs.** Notion links one page by several URL forms; PRs are matched to cards by
  the 32-hex page id.
- **Auto-merge checks GitHub, not the card's own notes.** A review must exist on the PR's current
  head commit, and no reviewer's latest decision may be "changes requested". The merge call pins
  the head commit, so a push that lands between the check and the merge makes the merge fail.
  This closes the gap where a "request changes" pressed between a rework push and the agent's
  `Addressed` note could be merged over.
- **A block clears itself on rework.** `## Blocked` stops `Auto-merge`; the agent renames it to
  `## Blocked (resolved …)` when it picks the card up again, so a fixed card does not stay stuck.
- **Claims tolerate simultaneous runs.** Each run writes a timestamped `Claimed:` line, waits,
  re-reads, and the earliest claim wins. Losers mark theirs `Released` and move on.
- **Incidents never fix themselves.** The incident routine investigates read-only and leaves the
  card in `Backlog`. A person decides what happens.
- **"Unknown" is not "no".** The stage detector reports a stage it could not check as unknown,
  and board sync never removes a stage for that reason.

## Not yet verified

Stated plainly so nobody relies on these by accident:

- `deploy.sh` has only run against stand-in `aws` and `curl` commands (`tests/deploy.test.sh`).
  Least certain: the `--invoked-via-function-url` option to `aws lambda add-permission`. If it is
  wrong, the smoke check at the end of the script reports a 403.
- The claim protocol is instructions for agents; it has not been exercised by real simultaneous
  runs.
- `record-walkthrough.mjs` is tested with a fake page object, not with a real browser.
- Installing pstack in cloud sessions: through `.claude/settings.json` (`extraKnownMarketplaces`
  / `enabledPlugins`) and through `cloud-setup.sh` (`claude plugin marketplace add` /
  `claude plugin install`). Neither has been checked in a real cloud environment yet; the
  board-loop skill blocks the card if poteto-mode is missing, so a failure is visible.
- Nothing has run end to end (card → routine → PR → auto-merge → sync).

## Known limits

- Stage detection uses git ancestry. If changes reach a stage by cherry-pick rather than by
  merging or fast-forwarding, use `deployedShaCommand` with a commit that contains them, or the
  stage will read as not reached.
- The relay's debounce is per Lambda instance; under bursts two instances can each fire once.
- PRs that change only docs may not run your CI's checks (for example with `paths-ignore`), and
  then `Auto-merge` waits on "checks green". Make sure at least one check runs on every PR.
