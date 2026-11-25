'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { prStage } = require('../kit/scripts/pr-stage.js');

const MERGE = 'a'.repeat(40);
const DEPLOYED = 'b'.repeat(40);

const config = {
  repo: 'owner/repo',
  stages: [
    { name: 'main', ref: 'origin/main' },
    { name: 'staging', ref: 'origin/staging' },
    { name: 'production', deployedShaCommand: 'print-deployed-sha' },
  ],
};

// A fake `exec` driven by a table: prs (gh api), ancestors ("sha target" → exit code),
// commits present locally, and the deployed sha command's result.
function fakeExec({ prs = {}, ancestors = {}, present = [MERGE, DEPLOYED], deployed = { status: 0, stdout: `${DEPLOYED}\n` } } = {}) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'gh') {
      const n = args[1].split('/').pop();
      const pr = prs[n];
      return pr ? { status: 0, stdout: JSON.stringify(pr), stderr: '' } : { status: 1, stdout: '', stderr: 'Not Found' };
    }
    if (cmd === 'sh') return { stderr: '', ...deployed };
    if (args[0] === 'cat-file') return { status: present.includes(args[2].replace('^{commit}', '')) ? 0 : 1 };
    if (args[0] === 'fetch') return { status: 0 };
    if (args[0] === 'merge-base') return { status: ancestors[`${args[2]} ${args[3]}`] ?? 1 };
    throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
  };
  exec.calls = calls;
  return exec;
}

const merged = { state: 'closed', merged: true, merge_commit_sha: MERGE };

test('open and closed PRs reach no stage and touch no git', () => {
  const exec = fakeExec({ prs: { 1: { state: 'open', merged: false }, 2: { state: 'closed', merged: false } } });
  const out = prStage(['1', '2'], { config, exec });
  assert.deepEqual(out, [
    { pr: 1, state: 'open', mergeSha: null, reached: [], unknown: [] },
    { pr: 2, state: 'closed', mergeSha: null, reached: [], unknown: [] },
  ]);
  assert.ok(exec.calls.every((c) => c.startsWith('gh ')));
});

test('a merged PR reaches the stages whose ref or deployed commit contains it', () => {
  const exec = fakeExec({
    prs: { 7: merged },
    ancestors: { [`${MERGE} origin/main`]: 0, [`${MERGE} origin/staging`]: 1, [`${MERGE} ${DEPLOYED}`]: 0 },
  });
  const [out] = prStage([7], { config, exec });
  assert.deepEqual(out, { pr: 7, state: 'merged', mergeSha: MERGE, reached: ['main', 'production'], unknown: [] });
});

test('git that cannot tell (exit 128) makes the stage unknown, not unreached', () => {
  const exec = fakeExec({ prs: { 7: merged }, ancestors: { [`${MERGE} origin/main`]: 0, [`${MERGE} origin/staging`]: 128, [`${MERGE} ${DEPLOYED}`]: 1 } });
  const [out] = prStage([7], { config, exec });
  assert.deepEqual(out.reached, ['main']);
  assert.deepEqual(out.unknown, ['staging']);
});

test('a failing or garbage deployed-sha command makes production unknown', () => {
  for (const deployed of [{ status: 1, stdout: '' }, { status: 0, stdout: '<html>error</html>' }]) {
    const exec = fakeExec({ prs: { 7: merged }, ancestors: { [`${MERGE} origin/main`]: 0 }, deployed });
    const [out] = prStage([7], { config, exec });
    assert.deepEqual(out.unknown, ['production']);
  }
});

test('a deployed commit missing locally is fetched once, then unknown if still missing', () => {
  const exec = fakeExec({ prs: { 7: merged }, present: [MERGE], ancestors: { [`${MERGE} origin/main`]: 0 } });
  const [out] = prStage([7], { config, exec });
  assert.deepEqual(out.unknown, ['production']);
  assert.ok(exec.calls.includes(`git fetch --depth=200 origin ${DEPLOYED}`));
});

test('a merge commit missing locally makes every stage unknown', () => {
  const exec = fakeExec({ prs: { 7: merged }, present: [] });
  const [out] = prStage([7], { config, exec });
  assert.deepEqual(out.reached, []);
  assert.deepEqual(out.unknown, ['main', 'staging', 'production']);
});

test('rejects things that are not PR numbers', () => {
  assert.throws(() => prStage(['12; rm -rf /'], { config, exec: fakeExec() }), /not a PR number/);
});

test('reports a PR GitHub cannot find', () => {
  assert.throws(() => prStage([99], { config, exec: fakeExec() }), /gh api failed for PR 99/);
});

test('against a real git repository', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-stage-'));
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  try {
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'base');
    git('branch', 'staging');
    git('commit', '-q', '--allow-empty', '-m', 'the PR');
    const sha = git('rev-parse', 'HEAD');
    const realGit = (cmd, args) => {
      if (cmd === 'gh') return { status: 0, stdout: JSON.stringify({ state: 'closed', merged: true, merge_commit_sha: sha }), stderr: '' };
      if (cmd === 'sh') return { status: 0, stdout: `${sha}\n`, stderr: '' };
      const r = spawnSync(cmd, ['-C', dir, ...args], { encoding: 'utf8' });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    const cfg = {
      repo: 'o/r',
      stages: [
        { name: 'main', ref: 'main' },
        { name: 'staging', ref: 'staging' },
        { name: 'production', deployedShaCommand: 'x' },
      ],
    };
    const [out] = prStage([3], { config: cfg, exec: realGit });
    assert.deepEqual(out.reached, ['main', 'production']);
    assert.deepEqual(out.unknown, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
