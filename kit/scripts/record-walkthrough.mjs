#!/usr/bin/env node
// Records a walkthrough video of a running web app from a list of steps.
//
//   node scripts/record-walkthrough.mjs --steps walkthrough.json --out evidence [--base-url URL]
//
// Needs Playwright in the project: npm i -D playwright && npx playwright install chromium
//
// Steps file: a JSON array. Each step is one object with one action:
//   { "goto": "/path" }                          open a page (relative to --base-url)
//   { "click": "css or text=… selector" }
//   { "fill": "selector", "value": "text" }
//   { "press": "Enter" }                         keyboard key on the focused element
//   { "waitFor": "selector" }                    wait until the element is visible
//   { "expectText": "text" }                     fail unless the text is visible on the page
//   { "screenshot": "name" }                     save <out>/<name>.png
//   { "pause": 800 }                             milliseconds, so a viewer can follow
//   { "note": "text" }                           printed to the log only
// The run fails on the first step that fails, and the video still covers everything up to it.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ACTIONS = ['goto', 'click', 'fill', 'press', 'waitFor', 'expectText', 'screenshot', 'pause', 'note'];

export function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('steps must be a non-empty array');
  steps.forEach((step, i) => {
    const keys = Object.keys(step ?? {}).filter((k) => ACTIONS.includes(k));
    if (keys.length !== 1) {
      throw new Error(`step ${i + 1}: expected exactly one of ${ACTIONS.join(', ')}`);
    }
    if (keys[0] === 'fill' && typeof step.value !== 'string') {
      throw new Error(`step ${i + 1}: fill needs a string "value"`);
    }
    if (keys[0] === 'pause' && !(Number.isFinite(step.pause) && step.pause >= 0)) {
      throw new Error(`step ${i + 1}: pause needs a number of milliseconds`);
    }
  });
  return steps;
}

export async function runSteps(page, steps, { baseUrl = '', outDir = '.', log = console.log, timeout = 15000 } = {}) {
  validateSteps(steps);
  for (const [i, step] of steps.entries()) {
    const label = `step ${i + 1}/${steps.length}`;
    if ('goto' in step) {
      const url = /^https?:\/\//.test(step.goto) ? step.goto : new URL(step.goto, baseUrl).toString();
      log(`${label}: goto ${url}`);
      await page.goto(url, { timeout });
    } else if ('click' in step) {
      log(`${label}: click ${step.click}`);
      await page.click(step.click, { timeout });
    } else if ('fill' in step) {
      log(`${label}: fill ${step.fill}`);
      await page.fill(step.fill, step.value, { timeout });
    } else if ('press' in step) {
      log(`${label}: press ${step.press}`);
      await page.keyboard.press(step.press);
    } else if ('waitFor' in step) {
      log(`${label}: wait for ${step.waitFor}`);
      await page.waitForSelector(step.waitFor, { state: 'visible', timeout });
    } else if ('expectText' in step) {
      log(`${label}: expect text "${step.expectText}"`);
      await page.getByText(step.expectText).first().waitFor({ state: 'visible', timeout });
    } else if ('screenshot' in step) {
      const file = path.join(outDir, `${step.screenshot}.png`);
      log(`${label}: screenshot ${file}`);
      await page.screenshot({ path: file, fullPage: true });
    } else if ('pause' in step) {
      await page.waitForTimeout(step.pause);
    } else if ('note' in step) {
      log(`${label}: ${step.note}`);
    }
  }
}

export function parseArgs(argv) {
  const args = { out: 'evidence', baseUrl: '', width: 1280, height: 800 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
      i += 1;
      return argv[i];
    };
    if (flag === '--steps') args.steps = next();
    else if (flag === '--out') args.out = next();
    else if (flag === '--base-url') args.baseUrl = next();
    else if (flag === '--width') args.width = Number(next());
    else if (flag === '--height') args.height = Number(next());
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!args.steps) throw new Error('--steps is required');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const steps = validateSteps(JSON.parse(fs.readFileSync(args.steps, 'utf8')));
  fs.mkdirSync(args.out, { recursive: true });

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
    process.exit(2);
  }

  const size = { width: args.width, height: args.height };
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: args.out, size } });
  const page = await context.newPage();
  let failed = null;
  try {
    await runSteps(page, steps, { baseUrl: args.baseUrl, outDir: args.out });
  } catch (err) {
    failed = err;
  }
  const video = page.video();
  await context.close();
  await browser.close();

  const target = path.join(args.out, 'walkthrough.webm');
  if (video) {
    fs.renameSync(await video.path(), target);
    console.log(`video: ${target}`);
  }
  if (failed) {
    console.error(`walkthrough failed: ${failed.message}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
