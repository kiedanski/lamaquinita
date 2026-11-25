# Routine: board sync

Keeps the board in step with GitHub and with where each change has been deployed. Safe to run
often; it only writes to cards. Routine prompt:

```
Read .agents/routines/board-sync.md and follow it exactly.
```

## Steps

1. Read `.agents/lamaquinita.json`.
2. Query the board for cards in `Review` or `Done` that have a `PR`.
3. Fetch the stage refs the config names, shallowly:

   ```bash
   git fetch --depth=200 origin <branch for each stage that has a "ref">
   ```

4. Run, with the PR numbers from step 2:

   ```bash
   node scripts/pr-stage.js <pr number> [<pr number> …]
   ```

   It prints one JSON object per PR: `{ "pr", "state", "mergeSha", "reached": [stage names],
   "unknown": [stage names it could not check] }`.
5. For each card:
   - PR merged and card not in `Done` → move it to `Done`, add `Merged <ISO time>: <sha>` under
     `## Log` (someone merged on GitHub).
   - PR closed without merging and card in `Review` → move it to `Backlog`, add
     `## Blocked` with `PR closed without merging on <date>`.
   - Set `Reached` to exactly the `reached` list. A stage in `unknown` keeps its current value on
     the card; never remove a stage because it could not be checked.
6. Reply with one line per card that changed. Nothing else.
