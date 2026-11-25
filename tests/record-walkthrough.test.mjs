import test from 'node:test';
import assert from 'node:assert/strict';
import { runSteps, validateSteps, parseArgs } from '../kit/scripts/record-walkthrough.mjs';

function fakePage({ failOn } = {}) {
  const calls = [];
  const rec = (name) => async (...args) => {
    calls.push([name, ...args.filter((a) => typeof a !== 'object')]);
    if (failOn === name) throw new Error(`${name} failed`);
  };
  return {
    calls,
    goto: rec('goto'),
    click: rec('click'),
    fill: rec('fill'),
    keyboard: { press: rec('press') },
    waitForSelector: rec('waitForSelector'),
    getByText: (text) => ({ first: () => ({ waitFor: async () => { calls.push(['expectText', text]); if (failOn === 'expectText') throw new Error('text not found'); } }) }),
    screenshot: async ({ path }) => calls.push(['screenshot', path]),
    waitForTimeout: rec('pause'),
  };
}

test('runs every kind of step in order', async () => {
  const page = fakePage();
  await runSteps(page, [
    { goto: '/orders' },
    { goto: 'https://example.test/x' },
    { click: 'text=New' },
    { fill: '#name', value: 'Test item' },
    { press: 'Enter' },
    { waitFor: '.saved' },
    { expectText: 'Saved' },
    { screenshot: 'after' },
    { pause: 10 },
    { note: 'done' },
  ], { baseUrl: 'http://localhost:3000', outDir: 'out', log: () => {} });
  assert.deepEqual(page.calls, [
    ['goto', 'http://localhost:3000/orders'],
    ['goto', 'https://example.test/x'],
    ['click', 'text=New'],
    ['fill', '#name', 'Test item'],
    ['press', 'Enter'],
    ['waitForSelector', '.saved'],
    ['expectText', 'Saved'],
    ['screenshot', 'out/after.png'],
    ['pause', 10],
  ]);
});

test('stops at the first failing step', async () => {
  const page = fakePage({ failOn: 'expectText' });
  await assert.rejects(
    runSteps(page, [{ expectText: 'Nope' }, { click: 'x' }], { log: () => {} }),
    /text not found/,
  );
  assert.equal(page.calls.some(([n]) => n === 'click'), false);
});

test('validateSteps rejects malformed steps', () => {
  assert.throws(() => validateSteps([]), /non-empty/);
  assert.throws(() => validateSteps([{ jump: 1 }]), /exactly one/);
  assert.throws(() => validateSteps([{ click: 'a', goto: '/' }]), /exactly one/);
  assert.throws(() => validateSteps([{ fill: '#a' }]), /value/);
  assert.throws(() => validateSteps([{ pause: -1 }]), /milliseconds/);
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['--steps', 's.json', '--base-url', 'http://x']), {
    steps: 's.json', out: 'evidence', baseUrl: 'http://x', width: 1280, height: 800,
  });
  assert.throws(() => parseArgs([]), /--steps is required/);
  assert.throws(() => parseArgs(['--steps']), /needs a value/);
  assert.throws(() => parseArgs(['--steps', 'a', '--bogus']), /unknown flag/);
});
