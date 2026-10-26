import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, realpath, writeFile, rm, readFile, stat, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalPreview } from '../src/localPreview.js';
import { checkPreview, assertPreviewReady } from '../src/previewChecks.js';
import { createShareAccess } from '../src/shareAccess.js';
import { shareApplication } from '../src/shareApplication.js';
import { listShares, stopShare } from '../src/shareSessions.js';
import { shareDoctor } from '../src/shareDoctor.js';

const root = await realpath(await mkdtemp(join(tmpdir(), 'launchmate-complete-')));
process.env.LAUNCHMATE_SHARE_STATE_DIR = join(root, 'registry');
await mkdir(process.env.LAUNCHMATE_SHARE_STATE_DIR, { mode: 0o700 });
after(() => rm(root, { recursive: true, force: true }));

async function listen(t, server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/`;
}

test('JSON health checks work even when an API has no root page', async (t) => {
  const api = await listen(t, createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.statusCode = req.url === '/health' ? 200 : 404; res.end('{"ok":true}'); }));
  const preview = await listen(t, await createLocalPreview({ url: api, shareId: 'api-test' }));
  const health = await checkPreview(preview, '/health');
  assert.equal(health.content_type, 'application/json'); assertPreviewReady(health);
  assert.throws(() => assertPreviewReady({ path: '/', http_status: 404 }), { code: 'PREVIEW_NOT_READY' });
  assert.equal((await fetch(preview)).status, 404);
});

test('one preview routes the frontend and backend separately, preserving methods, business tokens and local cookies', async (t) => {
  const frontend = await listen(t, createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<h1>Frontend</h1>'); }));
  let backendUrl; let received;
  backendUrl = await listen(t, createServer(async (req, res) => {
    const bytes = []; for await (const chunk of req) bytes.push(chunk);
    received = { path: req.url, method: req.method, authorization: req.headers.authorization, check: req.headers['x-launchmate-check'], body: Buffer.concat(bytes).toString() };
    if (req.url === '/api/login') { res.writeHead(302, { Location: backendUrl + 'api/me', 'Set-Cookie': 'app_session=example; Domain=127.0.0.1; Path=/; HttpOnly' }); res.end(); return; }
    res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}');
  }));
  const preview = await listen(t, await createLocalPreview({ url: frontend, apiUrl: backendUrl, shareId: 'combined-test' }));
  assert.match(await (await fetch(preview)).text(), /Frontend/);
  const sent = await fetch(preview + 'api/notes', { method: 'POST', headers: { Authorization: 'Bearer application-token', 'X-Launchmate-Check': 'internal-secret' }, body: 'note data' });
  assert.equal(sent.status, 200);
  assert.deepEqual(received, { path: '/api/notes', method: 'POST', authorization: 'Bearer application-token', check: undefined, body: 'note data' });
  const login = await fetch(preview + 'api/login', { redirect: 'manual' });
  assert.equal(login.headers.get('location'), '/api/me'); assert.ok(!login.headers.get('set-cookie').includes('Domain='));
});

test('preview passwords protect both pages and APIs without consuming application authorization', async (t) => {
  let forwardedCookies; let forwardedToken;
  const backend = await listen(t, createServer((req, res) => { forwardedCookies = req.headers.cookie; forwardedToken = req.headers.authorization; res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); }));
  const guard = createShareAccess({ password: 'a-long-test-password', verificationToken: 'check-only-secret', checkPaths: ['/api/health'] });
  const preview = await listen(t, await createLocalPreview({ url: backend, shareId: 'protected-test', accessGuard: guard }));
  const refused = await fetch(preview + 'api/me', { headers: { Accept: 'application/json' } });
  assert.equal(refused.status, 401); assert.equal((await refused.json()).error.code, 'SHARE_PASSWORD_REQUIRED');
  const pageResponse = await fetch(preview, { redirect: 'manual' }); assert.equal(pageResponse.status, 303);
  const health = await fetch(preview + 'api/health', { headers: { 'X-Launchmate-Check': 'check-only-secret' } }); assert.equal(health.status, 200);
  assert.equal((await fetch(preview + 'api/me', { headers: { 'X-Launchmate-Check': 'check-only-secret', Accept: 'application/json' } })).status, 401);
  const wrong = await fetch(preview + '__launchmate_share/login', { method: 'POST', body: new URLSearchParams({ password: 'wrong' }) }); assert.equal(wrong.status, 401);
  const login = await fetch(preview + '__launchmate_share/login?next=%2F%2Fevil.example', { method: 'POST', body: new URLSearchParams({ password: 'a-long-test-password' }), redirect: 'manual' });
  assert.equal(login.status, 303); assert.equal(login.headers.get('location'), '/');
  const cookie = login.headers.get('set-cookie'); assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
  const access = await fetch(preview + 'api/me', { headers: { Cookie: cookie.split(';')[0] + '; app_session=kept', Authorization: 'Bearer user-token' } });
  assert.equal(access.status, 200); assert.equal(forwardedCookies, 'app_session=kept'); assert.equal(forwardedToken, 'Bearer user-token');
});

test('share status, duplicate reuse and authenticated stop operate on the exact controller', { skip: process.platform === 'win32' }, async (t) => {
  const appServer = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); });
  const app = await listen(t, appServer);
  const binary = join(root, 'session-cloudflared');
  await writeFile(binary, `#!${process.execPath}\nconsole.error('ORIGIN:'+process.argv[process.argv.indexOf('--url')+1]);console.error('https://session-preview.trycloudflare.com');setInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(0));\n`, { mode: 0o700 });
  let origin; let resolveReady; const ready = new Promise((resolve) => { resolveReady = resolve; });
  let publicHealthy = true; let publicChecks = 0;
  const options = { url: app, protected: true, confirmShare: true, cloudflared: binary, onProgress: (line) => { const match = /ORIGIN:(\S+)/.exec(line); if (match) origin = match[1]; }, fetchImpl: (address, request) => { publicChecks++; return publicHealthy ? fetch(new URL(new URL(address).pathname, origin), request) : Promise.resolve(new Response('unavailable', { status: 503 })); } };
  const running = shareApplication({ ...options, onReady: resolveReady });
  const first = await ready;
  t.after(async () => { await stopShare(first.id).catch(() => {}); await running; });
  assert.equal(first.verification.http, 'passed'); assert.equal(first.verification.business, 'not_checked');
  const password = (await readFile(first.password_file, 'utf8')).trim();
  assert.ok(password.length >= 24);
  assert.ok(!JSON.stringify(first).includes(password));
  assert.equal((await stat(first.password_file)).mode & 0o777, 0o600);
  assert.equal((await listShares(first.id)).shares[0].status, 'active');
  let reused;
  const previousChecks = publicChecks;
  await shareApplication({ ...options, onReady: (result) => { reused = result; } });
  assert.equal(reused.reused, true); assert.equal(reused.id, first.id); assert.equal(reused.url, first.url);
  assert.ok(publicChecks > previousChecks, 'reuse must check the public entry again');
  publicHealthy = false;
  await assert.rejects(shareApplication({ ...options, onReady: () => assert.fail('unhealthy share must not be delivered') }), { code: 'SHARE_VERIFICATION_FAILED' });
  publicHealthy = true;
  appServer.closeAllConnections(); await new Promise((resolve) => appServer.close(resolve));
  await assert.rejects(shareApplication({ ...options, onReady: () => assert.fail('stopped app must not be delivered') }), { code: 'SHARE_VERIFICATION_FAILED' });
  await new Promise((resolve) => appServer.listen(Number(new URL(app).port), '127.0.0.1', resolve));
  await shareApplication({ ...options, onReady: (result) => { reused = result; } });
  assert.equal(reused.id, first.id);
  const raw = JSON.parse(await readFile(join(process.env.LAUNCHMATE_SHARE_STATE_DIR, first.id + '.json'), 'utf8'));
  const wrongStop = await fetch(raw.control_url + 'stop', { method: 'POST', headers: { Authorization: 'Bearer wrong' } }); assert.equal(wrongStop.status, 403);
  assert.equal((await fetch(raw.control_url + 'verify', { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 403);
  await stopShare(first.id); await running;
  assert.equal((await listShares(first.id)).shares[0].status, 'stopped');
  await assert.rejects(fetch(origin)); assert.equal((await fetch(app)).status, 200);
  assert.equal((await readFile(first.password_file, 'utf8')).trim(), password);
  assert.ok(!JSON.stringify(await listShares()).includes(raw.control_token));
});

test('preview password failures are throttled and cannot be bypassed with a business token', async (t) => {
  const api = await listen(t, createServer((req, res) => res.end('private')));
  const accessGuard = createShareAccess({ password: 'long-protected-preview-password', verificationToken: 'private-probe', checkPaths: ['/health'] });
  const preview = await listen(t, await createLocalPreview({ url: api, shareId: 'throttle-test', accessGuard }));
  for (let i = 0; i < 10; i++) {
    assert.equal((await fetch(preview + '__launchmate_share/login', { method: 'POST', body: new URLSearchParams({ password: 'wrong' }) })).status, 401);
  }
  const blocked = await fetch(preview + '__launchmate_share/login', { method: 'POST', body: new URLSearchParams({ password: 'long-protected-preview-password' }) });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '60');
  assert.equal((await fetch(preview + 'api/data', { headers: { Accept: 'application/json', Authorization: 'Bearer application-token' } })).status, 401);
});

test('unverifiable controller records never send a stop request', async (t) => {
  const requests = [];
  const controller = await listen(t, createServer((req, res) => { requests.push(req.url); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id: randomUUID(), status: 'active' })); }));
  const id = randomUUID();
  const state = { id, status: 'active', control_url: controller, control_token: 'a'.repeat(64), pid: process.pid };
  await writeFile(join(process.env.LAUNCHMATE_SHARE_STATE_DIR, id + '.json'), JSON.stringify(state), { mode: 0o600 });
  assert.equal((await listShares(id)).shares[0].status, 'unreachable');
  await assert.rejects(stopShare(id), { code: 'SHARE_SESSION_UNREACHABLE' });
  assert.deepEqual(requests, ['/status', '/status']);
});

test('status records cannot be redirected through symlinks', { skip: process.platform === 'win32' }, async () => {
  const id = randomUUID(); const target = join(root, 'unrelated.json');
  await writeFile(target, JSON.stringify({ id, status: 'stopped' }));
  await symlink(target, join(process.env.LAUNCHMATE_SHARE_STATE_DIR, id + '.json'));
  await assert.rejects(listShares(id), /分享状态文件不合法/);
  assert.deepEqual(JSON.parse(await readFile(target)), { id, status: 'stopped' });
});

test('doctor reports missing dependencies without starting a share', async () => {
  const report = await shareDoctor({ cloudflared: join(root, 'missing-client') });
  assert.equal(report.node.ready, true); assert.equal(report.cloudflared.ready, false); assert.equal(report.system, process.platform);
});
