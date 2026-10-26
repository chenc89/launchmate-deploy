import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, realpath, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('hard-killing the share parent revokes its tunnel and removes only its private configuration', { skip: process.platform === 'win32' }, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'launchmate-disconnect-')));
  const binary = join(root, 'fake-cloudflared');
  await writeFile(binary, `#!${process.execPath}\nconsole.log(JSON.stringify({pid:process.pid,config:process.argv[process.argv.indexOf('--config')+1]}));setInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(0));\n`, { mode: 0o700 });
  const entry = join(root, 'parent.mjs');
  await writeFile(entry, `import { createQuickTunnel } from ${JSON.stringify(new URL('../src/quickTunnel.js', import.meta.url).href)};const child=await createQuickTunnel({origin:'http://127.0.0.1:1/',binary:${JSON.stringify(binary)}});child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);\n`);
  const parent = spawn(process.execPath, [entry], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
  let output = ''; let tunnel;
  parent.stdout.on('data', (chunk) => { output += chunk; });
  t.after(async () => { parent.kill('SIGKILL'); if (tunnel) { try { process.kill(tunnel.pid, 'SIGTERM'); } catch {} } await rm(root, { recursive: true, force: true }); });
  for (let i = 0; i < 100 && !output.includes('\n'); i++) await delay(25);
  assert.ok(output.includes('\n'), 'owned tunnel did not start');
  tunnel = JSON.parse(output.trim());
  await access(tunnel.config);
  parent.kill('SIGKILL');
  let alive = true;
  for (let i = 0; i < 100; i++) {
    try { process.kill(tunnel.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    if (!alive) break;
    await delay(25);
  }
  assert.equal(alive, false, 'tunnel survived its parent');
  for (let i = 0; i < 100; i++) {
    try { await access(tunnel.config); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await delay(25);
  }
  assert.fail('private tunnel configuration was left behind');
});
