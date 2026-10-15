import { Sandbox } from '@vercel/sandbox';
import { writeFile } from 'node:fs/promises';

const name = `mdac-browser-image-${Date.now()}`;
const sandbox = await Sandbox.create({ name, region: 'sin1', persistent: false, timeout: 600_000, resources: { vcpus: 2 }, tags: { purpose: 'mdac-clean-browser' } });
let snapshot;
try {
  await sandbox.mkDir('browser');
  for (const [cmd, args] of [
    ['npm', ['install', '--no-audit', '--no-fund', '--save-exact', 'playwright@1.64.1']],
    ['npx', ['playwright', 'install', '--with-deps', 'chromium']],
  ]) {
    const result = await sandbox.runCommand({ cmd, args, cwd: '/vercel/browser', timeoutMs: 450_000 });
    if (result.exitCode !== 0) throw new Error(`Browser image setup failed: ${cmd}`);
    console.log(JSON.stringify({ step: cmd, exitCode: result.exitCode }));
  }
  await sandbox.writeFiles([{ path: 'browser/check.mjs', content: Buffer.from(`import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('data:text/html,<h1>Clean browser image</h1>');
if (await page.locator('h1').textContent() !== 'Clean browser image') throw Error('Headed browser check failed');
await browser.close();
`) }]);
  const check = await sandbox.runCommand({ cmd: 'xvfb-run', args: ['-a', 'node', 'check.mjs'], cwd: '/vercel/browser', timeoutMs: 30_000 });
  if (check.exitCode !== 0) throw new Error('Headed browser check failed');
  await sandbox.runCommand({ cmd: 'rm', args: ['-f', '/vercel/browser/check.mjs'] });
  snapshot = await sandbox.snapshot({ expiration: 30 * 24 * 60 * 60 * 1000 });
  const result = { snapshotId: snapshot.snapshotId, purpose: 'mdac-clean-browser', playwright: '1.64.1', headedCheck: true, officialNavigation: false, userData: false, expiresAt: snapshot.expiresAt };
  await writeFile('/tmp/mdac-redesign/browser-image.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (!snapshot) await sandbox.stop().catch(() => {});
  await sandbox.delete();
}
