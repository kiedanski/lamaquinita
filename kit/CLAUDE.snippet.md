## Board loop

<!-- Paste this section into the project's CLAUDE.md. -->

Work comes from the Notion board described in `.agents/lamaquinita.json`. Before touching a card,
read `.claude/skills/board-loop/SKILL.md`.

### How to work

Every change is worked in **poteto-mode** from the pstack plugin (enabled in
`.claude/settings.json`). Before the first change in a session, load the `poteto-mode` skill and
let it pick the playbook. In cloud sessions use `gh api …` (REST) for PR work; pstack's GraphQL
helpers are refused there.

### Finishing a change

A change is finished when all of these hold:

1. The commands in `checks.beforePush` pass.
2. Evidence is on the card (`.claude/skills/walkthrough-evidence/SKILL.md`).
3. The PR is open, its body ends with `Board card: <card URL>`, and the card is in `Review`.
4. Every review comment is fixed and its thread has a reply naming the commit. Nits get at most
   two rounds of pushes; after that, reply with why the rest is left.

A PR merges only with a person's approval: an approval on GitHub, a person saying "merge" in the
session, or `Auto-merge` ticked on the card by a person. Agents never tick `Auto-merge`.

### Production

Production is read-only for agents. The only commands allowed against it are listed in
`incidents.readOnlyCommands`. Nothing written by an agent (commits, PRs, cards, Slack, evidence)
contains personal data of real users.
