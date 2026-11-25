# Setup

You need: a GitHub repository, a Notion workspace, and a claude.ai plan with Claude Code on the
web (routines). Slack is only needed for the incident routine.

## 1. Copy the kit into your project

```bash
git clone https://github.com/kiedanski/lamaquinita
bash lamaquinita/bin/install.sh /path/to/your/project
```

Existing files are never overwritten. Then, in your project:

1. Fill in every `REPLACE_ME` in `.agents/lamaquinita.json` (the board URL and data source come
   from step 2).
2. Paste `lamaquinita/kit/CLAUDE.snippet.md` into your `CLAUDE.md`.
3. Add `evidence/` to `.gitignore`.
4. For web apps: `npm i -D playwright && npx playwright install chromium`, and make sure the
   cloud environment's setup script installs it too. Other kinds of app: replace the
   "Recording" section of the walkthrough-evidence skill with how yours is driven.
5. Commit and merge this to the default branch: routines read the instructions from there.

## 2. Create the board

Create a Notion database (full-page) with these properties. The names must match exactly.

| Property | Type | Options |
|---|---|---|
| `Name` | Title | |
| `Status` | Status | `Backlog`, `To do`, `In progress`, `Review`, `Done` |
| `Priority` | Select | `Urgent`, `High`, `Normal`, `Low` |
| `PR` | URL | |
| `Video` | Files & media | |
| `Session` | URL | |
| `Reached` | Multi-select | one option per stage `name` in the config |
| `Auto-merge` | Checkbox | |

Then, by hand in Notion: make `Backlog` the default `Status`, and add a board view grouped by
`Status`. Copy the database URL into `board.url` and its data source id (`collection://…`) into
`board.dataSource`. Asking an agent with the Notion connector to "fetch this database and give me
its data source id" is the quickest way to get the id.

## 3. Create the routines

At [claude.ai/code/routines](https://claude.ai/code/routines), for each routine: pick your
repository, a cloud environment that can run your project's checks, and the connectors it needs.

| Routine | Prompt | Connectors | Trigger |
|---|---|---|---|
| Board pickup | `Read .agents/routines/board-pickup.md and follow it exactly.` | Notion, GitHub | Schedule: hourly (every 6 hours once the webhook is set up) |
| Board sync | `Read .agents/routines/board-sync.md and follow it exactly.` | Notion, GitHub | Schedule: a few times a day |
| Incident response (optional) | `Read .agents/routines/incident-response.md and follow it exactly.` | Notion, GitHub, Slack | API, called by your monitoring tool for critical alerts only |

Routines run with nobody watching. In your connector settings
([claude.ai/customize/connectors](https://claude.ai/customize/connectors)) set the Notion,
GitHub and Slack tools the routines use to always allowed; otherwise a run stops at the first
"Allow once" prompt.

## 4. Try it

1. Write a small card ("Change the footer text to …") and move it to `To do`.
2. Press **Run now** on the pickup routine.
3. Within one run the card should reach `Review` with a PR and a video. Read the session (the
   card's `Session` link) if it does not.
4. Tick `Auto-merge` (or approve on GitHub) and run the pickup again.

## 5. Optional: pick cards up immediately

See [webhook.md](webhook.md).
