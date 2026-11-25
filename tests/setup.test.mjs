import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasPlaceholders, githubRepoFromRemote, normalizeDataSource, parseStages, mergePstackSettings, nextSteps } from '../bin/setup.mjs';

const SETUP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'setup.mjs');

function project({ claudeMd, settings, gitignore, pkg } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-'));
  const git = (...a) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', 'git@github.com:someone/shop.git');
  if (claudeMd) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);
  if (gitignore) fs.writeFileSync(path.join(dir, '.gitignore'), gitignore);
  if (pkg) fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  if (settings) {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
  }
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  return { dir, git };
}

const run = (dir, args = [], input = '') =>
  spawnSync(process.execPath, [SETUP, dir, ...args], { input, encoding: 'utf8' });
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

test('helpers', () => {
  assert.equal(githubRepoFromRemote('git@github.com:a/b.git'), 'a/b');
  assert.equal(githubRepoFromRemote('https://github.com/a/b'), 'a/b');
  assert.equal(githubRepoFromRemote('https://gitlab.com/a/b'), '');
  assert.equal(normalizeDataSource('0F1E2D3C4B5A69788796A5B4C3D2E1F0'), 'collection://0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0');
  assert.equal(normalizeDataSource('collection://x'), 'collection://x');
  assert.deepEqual(parseStages('main=origin/main, prod=$(curl -s https://x/version)'), [
    { name: 'main', ref: 'origin/main' },
    { name: 'prod', deployedShaCommand: 'curl -s https://x/version' },
  ]);
  assert.throws(() => parseStages('main'), /name=ref/);
  const merged = mergePstackSettings({ permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { other: true } });
  assert.deepEqual(merged.permissions, { allow: ['Bash(ls)'] });
  assert.equal(merged.enabledPlugins.other, true);
  assert.equal(merged.enabledPlugins['pstack@pstack-claude'], true);
});

test('--yes sets up a fresh project with defaults', () => {
  const { dir } = project({ pkg: { scripts: { test: 'jest', dev: 'vite' } } });
  const r = run(dir, ['--yes']);
  assert.equal(r.status, 0, r.stderr);
  const config = JSON.parse(read(dir, '.agents/lamaquinita.json'));
  assert.equal(config.repo, 'someone/shop');
  assert.deepEqual(config.checks.beforePush, ['npm test']);
  assert.equal(config.evidence.startApp, 'npm run dev');
  assert.deepEqual(config.stages, [{ name: 'main', ref: 'origin/main' }]);
  assert.equal(config.workflow.pstack, true);
  assert.equal(JSON.parse(read(dir, '.claude/settings.json')).enabledPlugins['pstack@pstack-claude'], true);
  assert.match(read(dir, 'CLAUDE.md'), /## Board loop[\s\S]*poteto-mode/);
  assert.match(read(dir, '.gitignore'), /^evidence\/$/m);
  assert.match(read(dir, '.agents/SETUP-NEXT-STEPS.md'), /someone\/shop/);
  assert.doesNotMatch(read(dir, '.agents/SETUP-NEXT-STEPS.md'), /Incident response/);
  assert.match(r.stdout, /\[7\/7\]/);
});

test('answers from stdin, existing files kept, committed on a branch', () => {
  const { dir, git } = project({
    claudeMd: '# Project rules\n\nBe nice.\n',
    settings: { permissions: { allow: ['Bash(ls)'] } },
    gitignore: 'node_modules\n',
  });
  const answers = [
    'me/app', // repo
    'trunk', // default branch
    'https://www.notion.so/Board-0123456789abcdef0123456789abcdef', // board
    '0123456789abcdef0123456789abcdef', // data source
    '3', // max in progress
    'make test, make lint', // checks
    'n', // evidence
    'main=origin/trunk,production=$(./bin/deployed-sha)', // stages
    '#ops', // slack
    'bin/logs', // read-only
    'y', // pstack
    'y', // commit
  ].join('\n');
  const r = run(dir, [], `${answers}\n`);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const config = JSON.parse(read(dir, '.agents/lamaquinita.json'));
  assert.equal(config.repo, 'me/app');
  assert.equal(config.board.dataSource, 'collection://01234567-89ab-cdef-0123-456789abcdef');
  assert.equal(config.maxInProgress, 3);
  assert.deepEqual(config.checks.beforePush, ['make test', 'make lint']);
  assert.equal(config.evidence.required, false);
  assert.deepEqual(config.stages[1], { name: 'production', deployedShaCommand: './bin/deployed-sha' });
  assert.deepEqual(config.incidents.readOnlyCommands, ['bin/logs']);
  assert.equal(hasPlaceholders(config), false);

  const settings = JSON.parse(read(dir, '.claude/settings.json'));
  assert.deepEqual(settings.permissions, { allow: ['Bash(ls)'] });
  assert.equal(settings.enabledPlugins['pstack@pstack-claude'], true);
  assert.match(read(dir, 'CLAUDE.md'), /^# Project rules\n\nBe nice\.\n\n## Board loop/);
  assert.equal(read(dir, '.gitignore'), 'node_modules\nevidence/\n.agents/SETUP-NEXT-STEPS.md\n');
  assert.match(read(dir, '.agents/SETUP-NEXT-STEPS.md'), /Incident response[\s\S]*#ops/);

  assert.equal(git('branch', '--show-current').stdout.trim(), 'lamaquinita-setup');
  const files = git('show', '--name-only', '--format=', 'HEAD').stdout;
  assert.match(files, /\.agents\/lamaquinita\.json/);
  assert.match(files, /\.claude\/skills\/board-loop\/SKILL\.md/);
  assert.doesNotMatch(files, /SETUP-NEXT-STEPS/);

  // Running again on a configured project keeps the answers.
  const again = run(dir, ['--yes']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /keeping the existing settings/);
  assert.deepEqual(JSON.parse(read(dir, '.agents/lamaquinita.json')), config);
});

test('a second run keeps settings and does not duplicate anything', () => {
  const { dir } = project();
  assert.equal(run(dir, ['--yes']).status, 0);
  const before = ['CLAUDE.md', '.gitignore', '.agents/lamaquinita.json', '.claude/settings.json'].map((f) => read(dir, f));
  const r = run(dir, ['--yes']);
  assert.equal(r.status, 0, r.stderr);
  // --yes answers "n" to "answer again?" when the config has no REPLACE_ME left; with REPLACE_ME
  // left (no board given) it re-asks and the defaults produce the same file.
  const after = ['CLAUDE.md', '.gitignore', '.agents/lamaquinita.json', '.claude/settings.json'].map((f) => read(dir, f));
  assert.deepEqual(after, before);
});

test('saying no to pstack leaves settings.json alone and drops the How to work section', () => {
  const { dir } = project();
  const answers = ['', '', '', '', '', '', 'n', '', '', '', 'n', 'n'].join('\n');
  const r = run(dir, [], `${answers}\n`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'settings.json')), false);
  assert.equal(JSON.parse(read(dir, '.agents/lamaquinita.json')).workflow.pstack, false);
  assert.doesNotMatch(read(dir, 'CLAUDE.md'), /How to work/);
});

test('refuses a directory that is not a git repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
  const r = run(dir, ['--yes']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a git repository/);
});

test('nextSteps lists every stage as a Reached option', () => {
  const text = nextSteps(
    { board: { url: 'REPLACE_ME' }, repo: 'a/b', defaultBranch: 'main', stages: [{ name: 'main' }, { name: 'prod' }], incidents: { slackChannel: '' } },
    { pstack: true },
  );
  assert.match(text, /\| `Reached` \| Multi-select \| `main`, `prod` \|/);
  assert.match(text, /claude plugin install pstack@pstack-claude/);
});
