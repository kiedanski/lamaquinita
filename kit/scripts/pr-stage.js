#!/usr/bin/env node
// Which deployment stages has each PR reached?
//
//   node scripts/pr-stage.js <pr number> [<pr number> …]
//
// Reads the stages from .agents/lamaquinita.json. A stage is either
//   { "name": "staging", "ref": "origin/staging" }                    reached when the PR's merge
//                                                                    commit is an ancestor of the ref
//   { "name": "production", "deployedShaCommand": "<shell command>" } reached when the merge commit
//                                                                    is an ancestor of the commit
//                                                                    the command prints
// Prints one JSON object per PR, one per line:
//   { "pr": 12, "state": "merged", "mergeSha": "…", "reached": ["main"], "unknown": ["production"] }
// A stage lands in "unknown" when it could not be checked (missing history, command failed).
// Fetch the stage branches with enough depth first (git fetch --depth=200 origin <branch>).

'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SHA = /^[0-9a-f]{7,40}$/;

function defaultExec(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function loadConfig(file = path.join('.agents', 'lamaquinita.json')) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!config.repo || !/^[^/\s]+\/[^/\s]+$/.test(config.repo)) throw new Error('config.repo must be "owner/name"');
  if (!Array.isArray(config.stages)) throw new Error('config.stages must be an array');
  return config;
}

function getPr(repo, number, exec) {
  const res = exec('gh', ['api', `repos/${repo}/pulls/${number}`]);
  if (res.status !== 0) throw new Error(`gh api failed for PR ${number}: ${res.stderr.trim()}`);
  const pr = JSON.parse(res.stdout);
  const state = pr.merged ? 'merged' : pr.state; // "open" | "closed" | "merged"
  return { state, mergeSha: pr.merged ? pr.merge_commit_sha : null };
}

// 0 → yes, 1 → no, anything else → could not tell.
function isAncestor(sha, target, exec) {
  const res = exec('git', ['merge-base', '--is-ancestor', sha, target]);
  if (res.status === 0) return true;
  if (res.status === 1) return false;
  return null;
}

function hasCommit(sha, exec) {
  return exec('git', ['cat-file', '-e', `${sha}^{commit}`]).status === 0;
}

function ensureCommit(sha, exec) {
  if (hasCommit(sha, exec)) return true;
  exec('git', ['fetch', '--depth=200', 'origin', sha]);
  return hasCommit(sha, exec);
}

function deployedSha(stage, exec) {
  const res = exec('sh', ['-c', stage.deployedShaCommand]);
  if (res.status !== 0) return null;
  const sha = res.stdout.trim().toLowerCase();
  return SHA.test(sha) ? sha : null;
}

function stagesFor(mergeSha, stages, exec) {
  const reached = [];
  const unknown = [];
  if (!ensureCommit(mergeSha, exec)) {
    return { reached, unknown: stages.map((s) => s.name) };
  }
  for (const stage of stages) {
    let target = null;
    if (stage.ref) target = stage.ref;
    else if (stage.deployedShaCommand) {
      const sha = deployedSha(stage, exec);
      if (sha && ensureCommit(sha, exec)) target = sha;
    }
    const answer = target ? isAncestor(mergeSha, target, exec) : null;
    if (answer === true) reached.push(stage.name);
    else if (answer === null) unknown.push(stage.name);
  }
  return { reached, unknown };
}

function prStage(numbers, { config, exec = defaultExec } = {}) {
  return numbers.map((raw) => {
    const pr = Number(raw);
    if (!Number.isInteger(pr) || pr <= 0) throw new Error(`not a PR number: ${raw}`);
    const { state, mergeSha } = getPr(config.repo, pr, exec);
    if (state !== 'merged') return { pr, state, mergeSha: null, reached: [], unknown: [] };
    return { pr, state, mergeSha, ...stagesFor(mergeSha, config.stages, exec) };
  });
}

if (require.main === module) {
  try {
    const numbers = process.argv.slice(2);
    if (numbers.length === 0) {
      console.error('usage: node scripts/pr-stage.js <pr number> [<pr number> …]');
      process.exit(2);
    }
    for (const line of prStage(numbers, { config: loadConfig() })) console.log(JSON.stringify(line));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { prStage, stagesFor, loadConfig, isAncestor };
