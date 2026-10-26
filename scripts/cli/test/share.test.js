import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtemp, realpath, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalPreview, localPreviewUrl } from '../src/localPreview.js';
import { shareApplication } from '../src/shareApplication.js';
import { parseArguments } from '../src/shareCli.js';

const registry = await realpath(await mkdtemp(join(tmpdir(), 'launchmate-share-state-')));
process.env.LAUNCHMATE_SHARE_STATE_DIR = registry;
after(() => rm(registry, { recursive: true, force: true }));

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'launchmate-share ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'index.html'), '<h1>Client preview</h1>');
  return root;
}

async function listen(t, server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/`;
}

function get(url, path, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request(url, { path, headers, method }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}

test('share accepts exactly one local target and never executes application source', async (t) => {
  const root = await fixture(t);
  assert.deepEqual(parseArguments(['share', '--dir', root]), { command: 'share', options: { dir: root } });
  await assert.rejects(createLocalPreview({ directory: root, url: 'http://127.0.0.1:5173/' }));
  await assert.rejects(createLocalPreview({}));
  await assert.rejects(shareApplication({ directory: root }), { code: 'SHARE_CONFIRMATION_REQUIRED' });
  await assert.rejects(shareApplication({ directory: root, confirmShare: 'false' }), { code: 'SHARE_CONFIRMATION_REQUIRED' });
  assert.equal(localPreviewUrl('http://localhost:5173/').hostname, '127.0.0.1');
  for (const url of ['http://remote.example:5173/', 'http://127.0.0.1/', 'http://user:secret@localhost:5173/', 'http://localhost:5173/admin', 'http://localhost:5173/?token=x', 'https://localhost:5173/', 'file:///tmp/index.html']) assert.throws(() => localPreviewUrl(url));
  await writeFile(join(root, 'package.json'), '{"scripts":{"dev":"never execute"}}');
  await assert.rejects(createLocalPreview({ directory: root }), { code: 'SOURCE_DIRECTORY' });
});

test('static sharing preserves audio, supports ranges and live edits, and blocks private files and traversal', async (t) => {
  const root = await fixture(t);
  const audio = Buffer.from([0x49, 0x44, 0x33, 0, 0xff, 0x80]);
  await writeFile(join(root, 'clip.mp3'), audio);
  await writeFile(join(root, '.env'), 'private');
  await writeFile(join(root, 'credentials.json'), '{"private":true}');
  await writeFile(join(root, 'data.sqlite'), 'private');
  await mkdir(join(root, 'work')); await writeFile(join(root, 'work', 'private.json'), '{}');
  if (process.platform !== 'win32') await symlink(join(root, 'index.html'), join(root, 'linked.html'));
  const url = await listen(t, await createLocalPreview({ directory: root, shareId: 'test-session' }));
  const home = await get(url, '/');
  assert.equal(home.status, 200); assert.equal(home.headers['x-launchmate-preview'], 'test-session');
  assert.equal(home.headers['cache-control'], 'no-store');
  const full = await get(url, '/clip.mp3');
  assert.equal(full.headers['content-type'], 'audio/mpeg'); assert.deepEqual(full.body, audio);
  const range = await get(url, '/clip.mp3', { Range: 'bytes=1-3' });
  assert.equal(range.status, 206); assert.equal(range.headers['content-range'], 'bytes 1-3/6'); assert.deepEqual(range.body, audio.subarray(1, 4));
  assert.equal((await get(url, '/clip.mp3', {}, 'HEAD')).body.length, 0);
  assert.equal((await get(url, '/clip.mp3', { Range: 'bytes=99-100' })).status, 416);
  await writeFile(join(root, 'index.html'), '<h1>Updated for client</h1>');
  assert.match((await get(url, '/')).body.toString(), /Updated for client/);
  assert.equal((await get(url, '/nested/view', { Accept: 'text/html' })).status, 200);
  for (const path of ['/.env', '/%2eenv', '/credentials.json', '/data.sqlite', '/work/private.json', '/../index.html', '/%2e%2e/index.html', '/linked.html', '/missing.js', '/.launchmate/project.json']) assert.equal((await get(url, path)).status, 404, path);
  assert.equal((await get(url, '/', {}, 'POST')).status, 405);
});

test('URL sharing proxies the chosen HTTP app, denies filesystem routes and leaves its server running', async (t) => {
  const requests = [];
  const app = createServer((req, res) => { requests.push({ url: req.url, host: req.headers.host, method: req.method }); res.setHeader('Content-Type', 'text/html'); res.end('<h1>Existing app</h1>'); });
  const upstream = await listen(t, app);
  const preview = await createLocalPreview({ url: upstream, shareId: 'proxy-session' });
  const url = await listen(t, preview);
  const response = await get(url, '/notes', {}, 'POST');
  assert.equal(response.status, 200); assert.equal(response.headers['x-launchmate-preview'], 'proxy-session');
  assert.deepEqual(requests[0], { url: '/notes', host: new URL(upstream).host, method: 'POST' });
  for (const path of ['/.env', '/@fs/private.txt', '/%252eenv', '/__open-in-editor', '/package.json', '/../private']) assert.equal((await get(url, path)).status, 404);
  assert.equal(requests.length, 1);
  assert.equal((await get(url, '/node_modules/.vite/deps/react.js')).status, 200);
  preview.closeAllConnections(); await new Promise((resolve) => preview.close(resolve));
  assert.equal((await fetch(upstream)).status, 200);
});

test('independent sharing verifies its own public response, strips credentials from the tunnel and cleans up on stop', { skip: process.platform === 'win32' }, async (t) => {
  const root = await fixture(t);
  const binary = join(root, 'fake-cloudflared');
  await writeFile(binary, `#!${process.execPath}\nconsole.error('ORIGIN:'+process.argv[process.argv.indexOf('--url')+1]);\nconsole.error('CREDENTIALS:'+Boolean(process.env.LAUNCHMATE_TOKEN || process.env.APP_KEY));\nconsole.error('PID:'+process.pid);\nconsole.error('https://unit-preview.trycloudflare.com');\nsetInterval(()=>{},1000);\nprocess.on('SIGTERM',()=>process.exit(0));\n`, { mode: 0o700 });
  const original = process.env.LAUNCHMATE_TOKEN; process.env.LAUNCHMATE_TOKEN = 'private-test-value';
  t.after(() => { if (original === undefined) delete process.env.LAUNCHMATE_TOKEN; else process.env.LAUNCHMATE_TOKEN = original; });
  let origin; let ready; let pid; const logs = [];
  const before = process.listenerCount('SIGINT');
  await shareApplication({ directory: root, cloudflared: binary, confirmShare: true,
    onProgress: (line) => { logs.push(line); const found = /ORIGIN:(\S+)/.exec(line); if (found) origin = found[1]; const foundPid = /PID:(\d+)/.exec(line); if (foundPid) pid = Number(foundPid[1]); },
    fetchImpl: async () => fetch(origin),
    onReady: (result) => { ready = result; process.emit('SIGINT'); },
  });
  assert.equal(ready.url, 'https://unit-preview.trycloudflare.com/'); assert.equal(ready.verified, true);
  assert.ok(logs.join('\n').includes('CREDENTIALS:false')); assert.ok(!logs.join('\n').includes('private-test-value'));
  assert.equal(process.listenerCount('SIGINT'), before);
  await assert.rejects(fetch(origin)); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('a failed tunnel never reports a usable share and closes its preview listener', { skip: process.platform === 'win32' }, async (t) => {
  const root = await fixture(t); const binary = join(root, 'failed-cloudflared'); let ready = false; let origin;
  await writeFile(binary, `#!${process.execPath}\nconsole.error('ORIGIN:'+process.argv[process.argv.indexOf('--url')+1]);\nconsole.error('https://failed-preview.trycloudflare.com');\nsetTimeout(()=>process.exit(1),100);\n`, { mode: 0o700 });
  await assert.rejects(shareApplication({ directory: root, cloudflared: binary, confirmShare: true,
    onProgress: (line) => { const found = /ORIGIN:(\S+)/.exec(line); if (found) origin = found[1]; },
    onReady: () => { ready = true; },
    fetchImpl: async () => { const response = await fetch(origin); const body = await response.arrayBuffer(); await delay(200); return new Response(body, { headers: response.headers }); },
  }), { code: 'SHARE_TUNNEL_EXITED' });
  assert.equal(ready, false);
  await assert.rejects(fetch(origin));
});

test('an existing Cloudflare configuration is preserved while a private configuration is used', { skip: process.platform === 'win32' }, async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, '.cloudflared'));
  const config = join(root, '.cloudflared/config.yml');
  await writeFile(config, 'existing configuration');
  const binary = join(root, 'isolated-cloudflared'); let origin; let configIsolated = false;
  await writeFile(binary, `#!${process.execPath}\nconst fs=require('node:fs');const path=process.argv[process.argv.indexOf('--config')+1];console.error('ISOLATED:'+String(fs.readFileSync(path,'utf8').trim()==='{}'));console.error('ORIGIN:'+process.argv[process.argv.indexOf('--url')+1]);console.error('https://isolated-preview.trycloudflare.com');setInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(0));\n`, { mode: 0o700 });
  await shareApplication({ directory: root, cloudflared: binary, confirmShare: true,
    onProgress: (line) => { if (line.includes('ISOLATED:true')) configIsolated = true; const found = /ORIGIN:(\S+)/.exec(line); if (found) origin = found[1]; },
    fetchImpl: () => fetch(origin), onReady: () => process.emit('SIGINT'),
  });
  assert.equal(configIsolated, true);
  assert.equal(await readFile(config, 'utf8'), 'existing configuration');
});
