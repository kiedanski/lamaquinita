#!/usr/bin/env node
// Guided setup of the board loop in a project.
//
//   node bin/setup.mjs /path/to/project          asks a few questions
//   node bin/setup.mjs /path/to/project --yes    takes every default
//
// What it does in the project (nothing outside it, nothing on the network):
//   1. checks the basics (git repo, Node, gh)
//   2. copies the kit (never overwrites a file)
//   3. writes .agents/lamaquinita.json from your answers
//   4. enables pstack (poteto-mode) in .claude/settings.json
//   5. adds the board-loop rules to CLAUDE.md and evidence/ to .gitignore
//   6. optionally commits all of it on a new branch
//   7. prints the steps that need a browser (Notion board, routines, connectors, webhook),
//      filled in with your values, and saves them to .agents/SETUP-NEXT-STEPS.md

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const KIT = path.join(ROOT, 'kit');
const PSTACK_MARKETPLACE = 'pstack-claude';
const PSTACK_PLUGIN = 'pstack@pstack-claude';
const SNIPPET_MARK = '## Board loop';

// ---------- input ------------------------------------------------------------------------

function makeAsker({ yes }) {
  if (yes) return { ask: async (_q, def = '') => def, close() {} };
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const queue = [];
  let waiter = null;
  let closed = false;
  rl.on('line', (line) => (waiter ? (waiter(line), (waiter = null)) : queue.push(line)));
  rl.on('close', () => {
    closed = true;
    if (waiter) waiter(null), (waiter = null);
  });
  const next = () =>
    queue.length ? Promise.resolve(queue.shift()) : closed ? Promise.resolve(null) : new Promise((r) => (waiter = r));
  return {
    async ask(question, def = '') {
      process.stdout.write(`  ${question}${def ? ` [${def}]` : ''}: `);
      const line = await next();
      if (line === null) process.stdout.write('\n');
      const answer = (line ?? '').trim();
      return answer || def;
    },
    close: () => rl.close(),
  };
}

export const hasPlaceholders = (config) =>
  JSON.stringify(config, (key, value) => (key.startsWith('$') ? undefined : value)).includes('REPLACE_ME');

const yesNo = (answer) => /^y(es)?$/i.test(String(answer).trim());

// ---------- helpers ----------------------------------------------------------------------

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const step = (n, total, title) => console.log(`\n[${n}/${total}] ${title}`);
const note = (text) => console.log(`  ${text}`);

export function githubRepoFromRemote(url) {
  const m = String(url).trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? `${m[1]}/${m[2]}` : '';
}

export function normalizeDataSource(value) {
  const v = String(value).trim();
  if (!v) return '';
  if (v.startsWith('collection://')) return v;
  const hex = v.replace(/-/g, '').match(/[0-9a-f]{32}/i)?.[0];
  if (!hex) return v;
  const h = hex.toLowerCase();
  return `collection://${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function parseStages(text) {
  return String(text)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, ...rest] = entry.split('=');
      const target = rest.join('=').trim();
      if (!name.trim() || !target) throw new Error(`stage "${entry}" should be name=ref or name=$(command)`);
      const cmd = target.match(/^\$\((.*)\)$/s);
      return cmd ? { name: name.trim(), deployedShaCommand: cmd[1].trim() } : { name: name.trim(), ref: target };
    });
}

const list = (text) => String(text).split(',').map((s) => s.trim()).filter(Boolean);

export function mergePstackSettings(existing) {
  const settings = existing && typeof existing === 'object' ? structuredClone(existing) : {};
  settings.extraKnownMarketplaces = {
    ...(settings.extraKnownMarketplaces ?? {}),
    [PSTACK_MARKETPLACE]: { source: { source: 'github', repo: 'michael-denyer/pstack-claude' } },
  };
  settings.enabledPlugins = { ...(settings.enabledPlugins ?? {}), [PSTACK_PLUGIN]: true };
  return settings;
}

// ---------- next steps -------------------------------------------------------------------

export function nextSteps(config, { pstack }) {
  const stages = config.stages.map((s) => `\`${s.name}\``).join(', ');
  const cloudSetup = fs.readFileSync(path.join(KIT, '.agents', 'cloud-setup.sh'), 'utf8').trim();
  const boardKnown = !String(config.board.url).includes('REPLACE_ME');
  return `# Board loop: steps left to do by hand

Written by lamaquinita's setup. Tick them off as you go; delete this file when done.

## 1. Notion board${boardKnown ? ' (you gave a URL: check its properties match)' : ''}

Create a full-page Notion database with exactly these properties:

| Property | Type | Options |
|---|---|---|
| \`Name\` | Title | |
| \`Status\` | Status | \`Backlog\`, \`To do\`, \`In progress\`, \`Review\`, \`Done\` |
| \`Priority\` | Select | \`Urgent\`, \`High\`, \`Normal\`, \`Low\` |
| \`PR\` | URL | |
| \`Video\` | Files & media | |
| \`Session\` | URL | |
| \`Reached\` | Multi-select | ${stages} |
| \`Auto-merge\` | Checkbox | |

Or ask Claude (with the Notion connector): "Create a Notion database called Board in <page>
with these properties: …" and paste the table above.

Then, by hand: make \`Backlog\` the default \`Status\`, add a board view grouped by \`Status\`,
and put the database URL and its data source id (\`collection://…\`) in
\`.agents/lamaquinita.json\` (\`board.url\`, \`board.dataSource\`).

## 2. Cloud environment

At claude.ai/code, create (or edit) the environment the routines will use:
- Network: the default allowlist${pstack ? ' (GitHub must be reachable for pstack)' : ''}.
- Setup script:

\`\`\`bash
${cloudSetup}
\`\`\`
${pstack ? '\n- To turn off pstack\'s automatic routing hook there, add `PSTACK_SESSION_HOOK=off` to the environment variables (cards still use poteto-mode through the board-loop skill).\n' : ''}
## 3. Routines (claude.ai/code/routines)

Repository \`${config.repo}\`, the environment above, connectors as listed.

| Routine | Prompt | Connectors | Trigger |
|---|---|---|---|
| Board pickup | \`Read .agents/routines/board-pickup.md and follow it exactly.\` | Notion, GitHub | Schedule: hourly |
| Board sync | \`Read .agents/routines/board-sync.md and follow it exactly.\` | Notion, GitHub | Schedule: a few times a day |
${config.incidents.slackChannel ? `| Incident response (optional) | \`Read .agents/routines/incident-response.md and follow it exactly.\` | Notion, GitHub, Slack (${config.incidents.slackChannel}) | API, from your monitoring tool |\n` : ''}
## 4. Connector permissions (claude.ai/customize/connectors)

Set the Notion, GitHub${config.incidents.slackChannel ? ' and Slack' : ''} tools to "always allow". Routines run unattended
and stop at the first "Allow once" prompt.

## 5. Merge this setup

The routines read the instructions from \`${config.defaultBranch}\`, so merge the setup branch first.

## 6. Try one card

1. Write a small card and move it to \`To do\`.
2. Press **Run now** on the pickup routine.
3. The card should reach \`Review\` with a PR and a video. If not, open the card's \`Session\` link.
4. Tick \`Auto-merge\` (or approve on GitHub) and run the pickup again.

## 7. Optional: pick cards up instantly

1. On the pickup routine: **Add another trigger** → **API** → **Generate token**; copy the URL and token.
2. Where the AWS CLI is signed in (AWS CloudShell works), from a lamaquinita checkout:
   \`bash infra/board-webhook/deploy.sh\`
3. In Notion, two automations on the board, each **Send webhook** to the printed URL with the
   custom header \`x-board-secret: <printed secret>\`: when \`Status\` is set to \`To do\`; when
   \`Auto-merge\` is checked.
4. Slow the pickup's schedule to every 6 hours.
`;
}

// ---------- main -------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  const yes = argv.includes('--yes');
  const target = argv.find((a) => !a.startsWith('--'));
  if (!target || !fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error('usage: node bin/setup.mjs <project dir> [--yes]');
    return 2;
  }
  const dir = path.resolve(target);
  const { ask, close } = makeAsker({ yes });
  const TOTAL = 7;

  try {
    console.log(`lamaquinita setup in ${dir}${yes ? ' (taking defaults)' : ''}`);

    // 1. basics
    step(1, TOTAL, 'Checking the basics');
    if (!sh('git', ['rev-parse', '--is-inside-work-tree'], dir).ok) {
      console.error('  error: not a git repository');
      return 1;
    }
    note(`node ${process.versions.node}`);
    if (Number(process.versions.node.split('.')[0]) < 20) note('warning: Node 20 or later is needed for the scripts');
    const gh = sh('gh', ['auth', 'status'], dir);
    note(gh.ok ? 'gh: signed in' : 'warning: gh is missing or not signed in (only needed to run scripts locally)');

    // 2. copy kit
    step(2, TOTAL, 'Copying the kit');
    const install = sh('bash', [path.join(ROOT, 'bin', 'install.sh'), dir], dir);
    if (!install.ok) {
      console.error(install.err || install.out);
      return 1;
    }
    install.out.split('\n').filter((l) => /^(copy|skip) /.test(l)).forEach((l) => note(l));

    // 3. settings
    step(3, TOTAL, 'Settings (.agents/lamaquinita.json)');
    const configPath = path.join(dir, '.agents', 'lamaquinita.json');
    let config = readJson(configPath);
    if (!config) {
      console.error('  error: .agents/lamaquinita.json is not valid JSON; fix or delete it and run again');
      return 1;
    }
    const unconfigured = hasPlaceholders(config);
    if (!unconfigured && !yesNo(await ask('Already configured. Answer the questions again? (y/N)', 'n'))) {
      note('keeping the existing settings');
    } else {
      const remoteRepo = githubRepoFromRemote(sh('git', ['remote', 'get-url', 'origin'], dir).out);
      const headRef = sh('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], dir).out.replace(/^origin\//, '');
      const pkg = readJson(path.join(dir, 'package.json'));
      const scripts = pkg?.scripts ?? {};

      const repo = await ask('GitHub repo (owner/name)', remoteRepo || config.repo);
      const defaultBranch = await ask('Default branch', headRef || config.defaultBranch || 'main');
      const boardUrl = await ask('Notion board URL (empty = fill in later)', '');
      const dataSource = normalizeDataSource(await ask('Board data source id (collection://… or the id; empty = later)', ''));
      const maxInProgress = Number(await ask('Cards built at once', String(config.maxInProgress ?? 5))) || 5;
      const checks = list(await ask('Commands that must pass before a push (comma-separated)', scripts.test ? 'npm test' : ''));
      const evidenceRequired = yesNo(await ask('Require a walkthrough video on every card? (Y/n)', 'y'));
      const startApp = evidenceRequired ? await ask('Command that starts the app', scripts.dev ? 'npm run dev' : scripts.start ? 'npm start' : '') : '';
      const appUrl = evidenceRequired ? await ask('App URL once started', 'http://localhost:3000') : '';
      const stages = parseStages(
        await ask('Stages, as name=ref or name=$(command printing the deployed commit), comma-separated', `main=origin/${defaultBranch}`),
      );
      const slackChannel = await ask('Slack channel for incidents (empty = no incident routine)', '');
      const readOnly = list(await ask('Read-only production commands (comma-separated, empty = none)', ''));

      config = {
        ...config,
        board: { url: boardUrl || config.board?.url, dataSource: dataSource || config.board?.dataSource },
        repo,
        defaultBranch,
        maxInProgress,
        checks: { ...config.checks, beforePush: checks },
        evidence: { ...config.evidence, required: evidenceRequired, startApp, appUrl },
        stages,
        incidents: { ...config.incidents, slackChannel, readOnlyCommands: readOnly },
      };
    }

    // 4. pstack
    step(4, TOTAL, 'pstack / poteto-mode');
    const settingsPath = path.join(dir, '.claude', 'settings.json');
    const settings = readJson(settingsPath);
    const hasPstack = Boolean(settings?.enabledPlugins?.[PSTACK_PLUGIN]);
    let pstack = config.workflow?.pstack !== false;
    if (hasPstack) {
      note('already enabled in .claude/settings.json');
    } else {
      pstack = yesNo(await ask('Build every card in poteto-mode (pstack plugin)? (Y/n)', 'y'));
      if (pstack) {
        if (fs.existsSync(settingsPath) && !settings) {
          console.error('  error: .claude/settings.json is not valid JSON; fix it and run again');
          return 1;
        }
        writeJson(settingsPath, mergePstackSettings(settings));
        note('enabled in .claude/settings.json');
      }
    }
    config.workflow = { ...config.workflow, pstack };
    writeJson(configPath, config);
    const missing = hasPlaceholders(config);
    note(missing ? 'settings saved; some values are still REPLACE_ME (see the next steps)' : 'settings saved');

    // 5. CLAUDE.md and .gitignore
    step(5, TOTAL, 'CLAUDE.md and .gitignore');
    const claudeMd = path.join(dir, 'CLAUDE.md');
    const current = fs.existsSync(claudeMd) ? fs.readFileSync(claudeMd, 'utf8') : '';
    if (current.includes(SNIPPET_MARK)) {
      note('CLAUDE.md already has the board-loop section');
    } else {
      let snippet = fs.readFileSync(path.join(KIT, 'CLAUDE.snippet.md'), 'utf8').replace(/<!--.*?-->\n*/s, '');
      if (!pstack) snippet = snippet.replace(/### How to work\n[\s\S]*?(?=### )/, '');
      fs.writeFileSync(claudeMd, `${current}${current && !current.endsWith('\n\n') ? (current.endsWith('\n') ? '\n' : '\n\n') : ''}${snippet}`);
      note('added the board-loop section to CLAUDE.md');
    }
    const gitignore = path.join(dir, '.gitignore');
    const ignored = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '';
    const toIgnore = ['evidence/', '.agents/SETUP-NEXT-STEPS.md'].filter(
      (entry) => !ignored.split('\n').some((line) => line.trim().replace(/^\//, '') === entry),
    );
    if (toIgnore.length === 0) note('.gitignore already has what it needs');
    else {
      fs.writeFileSync(gitignore, `${ignored}${ignored && !ignored.endsWith('\n') ? '\n' : ''}${toIgnore.join('\n')}\n`);
      note(`added ${toIgnore.join(', ')} to .gitignore`);
    }

    // 6. commit
    step(6, TOTAL, 'Commit');
    if (yesNo(await ask('Commit this on a new branch "lamaquinita-setup"? (y/N)', 'n'))) {
      const branch = sh('git', ['checkout', '-b', 'lamaquinita-setup'], dir);
      if (!branch.ok) note(`could not create the branch: ${branch.err}`);
      else {
        sh('git', ['add', '.agents', '.claude', 'scripts', 'CLAUDE.md', '.gitignore'], dir);
        const commit = sh('git', ['commit', '-m', 'Set up the board loop (lamaquinita)'], dir);
        note(commit.ok ? 'committed on lamaquinita-setup; push it and open a PR' : `commit failed: ${commit.err}`);
      }
    } else {
      note('not committed; review the changes with git status');
    }

    // 7. next steps
    step(7, TOTAL, 'What is left (saved to .agents/SETUP-NEXT-STEPS.md, not committed)');
    const steps = nextSteps(config, { pstack });
    fs.writeFileSync(path.join(dir, '.agents', 'SETUP-NEXT-STEPS.md'), steps);
    console.log(`\n${steps}`);
    return 0;
  } finally {
    close();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  main().then((code) => process.exit(code));
}
