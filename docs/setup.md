# Setup

You need: a GitHub repository, a Notion workspace, and a claude.ai plan with Claude Code on the
web (routines). Slack is only needed for the incident routine.

## 1. Run the setup script

```bash
git clone https://github.com/kiedanski/lamaquinita
node lamaquinita/bin/setup.mjs /path/to/your/project        # or --yes to take every default
```

It works only inside the project and never overwrites a file. It:

1. checks that the project is a git repository (and whether `gh` is signed in);
2. copies the kit (skills, routines, scripts, settings file);
3. asks for the settings and writes `.agents/lamaquinita.json`: GitHub repo and default branch
   (guessed from `origin`), board URL and data source (can be left for later), how many cards to
   build at once, the commands that must pass before a push, how to start the app for
   walkthroughs, the deployment stages, and the incident settings;
4. enables pstack in `.claude/settings.json` (merged into an existing file) so every card is
   built in poteto-mode;
5. adds the board-loop rules to `CLAUDE.md`, and `evidence/` to `.gitignore`;
6. optionally commits all of it on a branch `lamaquinita-setup`;
7. prints what is left to do by hand, filled in with your values, and saves it to
   `.agents/SETUP-NEXT-STEPS.md` (not committed). Those steps are the rest of this page.

Running it again is safe: it keeps a finished configuration unless you ask to redo it.

For web apps, also add Playwright to the project: `npm i -D playwright`. Other kinds of app:
replace the "Recording" section of the walkthrough-evidence skill with how yours is driven.

Merge the setup branch before creating the routines: they read the instructions from the default
branch.

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

## 3. Cloud environment

At claude.ai/code, create (or edit) the environment the routines run in and paste
`.agents/cloud-setup.sh` into its setup script. It installs the pstack plugin and, for projects
that use Playwright, its browser. The project's `.claude/settings.json` also enables pstack, so
either path is enough on its own.

pstack's automatic routing hook (which sends multi-file tasks to poteto-mode) runs in cloud
sessions too. To turn it off there, set `PSTACK_SESSION_HOOK=off` in the environment's variables;
cards are still built in poteto-mode because the board-loop skill asks for it. To build cards
without pstack at all, set `workflow.pstack` to `false` in `.agents/lamaquinita.json`.

Model and effort per pstack role can be set for the project in a committed
`.claude/pstack-models.md` (run `/pstack:setup-pstack` in a local session to write it). The
user-level sheet does not reach cloud sessions.

## 4. Create the routines

At [claude.ai/code/routines](https://claude.ai/code/routines), for each routine: pick your
repository, a cloud environment that can run your project's checks, and the connectors it needs.

| Routine | Prompt | Connectors | Trigger |
|---|---|---|---|
| Board pickup | `Read .agents/routines/board-pickup.md and follow it exactly. The card that started this run, if any, is named in the routine-fire-payload block.` | Notion, GitHub | Schedule: hourly (every 2 hours once the webhook is set up) |
| Board sync | `Read .agents/routines/board-sync.md and follow it exactly.` | Notion, GitHub | Schedule: a few times a day |
| Incident response (optional) | `Read .agents/routines/incident-response.md and follow it exactly.` | Notion, GitHub, Slack | API, called by your monitoring tool for critical alerts only |

Routines run with nobody watching. In your connector settings
([claude.ai/customize/connectors](https://claude.ai/customize/connectors)) set the Notion,
GitHub and Slack tools the routines use to always allowed; otherwise a run stops at the first
"Allow once" prompt.

## 5. Try it

1. Write a small card ("Change the footer text to …") and move it to `To do`.
2. Press **Run now** on the pickup routine.
3. Within one run the card should reach `Review` with a PR and a video. Read the session (the
   card's `Session` link) if it does not.
4. Tick `Auto-merge` (or approve on GitHub) and run the pickup again.

## 6. Optional: pick cards up immediately

See [webhook.md](webhook.md).
