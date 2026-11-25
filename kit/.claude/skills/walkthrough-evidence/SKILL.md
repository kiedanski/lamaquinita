---
name: walkthrough-evidence
description: How to prove a change works before it goes to Review — a recorded walkthrough of the real app, attached to the board card. Read before moving any card to Review.
---

# Walkthrough evidence

A reviewer should be able to see the change working without checking out the branch. Every card
that reaches `Review` carries evidence in its `Video` field, unless `evidence.required` is
`false` in `.agents/lamaquinita.json`.

## What counts

| Kind of change | Evidence |
|---|---|
| Anything a user can see or click | A video of the running app doing what the card asks, start to finish |
| API, job, script, CLI | A short recording or log of the real command or request and its output, plus the test run |
| Docs, config, refactor with no behaviour change | The test run output is enough; say so on the card |

The walkthrough shows the **new** behaviour on the **branch** build, with made-up data. It never
shows real users' data, secrets or tokens. If the app needs a sign-in, use a local test account.

## Recording a web app

1. Start the app with `evidence.startApp` and wait until `evidence.appUrl` answers.
2. Write the steps to `evidence/walkthrough.json` (see the header of
   `scripts/record-walkthrough.mjs` for the step format). Cover what the card asks, include at
   least one `expectText` that proves the result, and add short `pause` steps so a person can
   follow.
3. Record:

   ```bash
   node scripts/record-walkthrough.mjs --steps evidence/walkthrough.json --out evidence \
     --base-url "$APP_URL"
   ```

   It exits non-zero if a step fails. A failing walkthrough means the change is not done.
4. Watch it back (or at least look at the screenshots) before attaching it.

Projects that are not web apps replace this section in their own copy of the skill with how they
drive and record their app.

## Attaching it

1. Upload `evidence/walkthrough.webm` (and any screenshots) to the card's `Video` field with the
   Notion file-upload tools.
2. If the upload is not possible, attach it to the PR instead and put that link in `Video`.
3. Do not commit the `evidence/` folder. Add it to `.gitignore` if it is not already there.
4. In the PR body, under "How it was checked", say what the walkthrough shows in one or two lines.
