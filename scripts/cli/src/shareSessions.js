import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, lstat, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { equalSecret } from './shareAccess.js';
import { localPreviewUrl } from './localPreview.js';
import { LaunchmateError } from './errors.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const shareStateDirectory = () => process.env.LAUNCHMATE_SHARE_STATE_DIR || join(homedir(), '.launchmate', 'shares');

async function directory() {
  const path = shareStateDirectory();
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) throw new LaunchmateError('分享状态目录不是当前用户的安全目录。');
  return path;
}

async function jsonFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16384 || (process.getuid && info.uid !== process.getuid())) throw new LaunchmateError('分享状态文件不合法。');
  return JSON.parse(await readFile(path, 'utf8'));
}

function publicState(state) {
  return { id: state.id, status: state.status, target: state.target, url: state.url || null, local_url: state.local_url || null, temporary: true, protected: state.protected, password_file: state.password_file || null, verification: state.verification || null, created_at: state.created_at };
}

async function control(state, action = 'status') {
  const origin = localPreviewUrl(state.control_url);
  if (!UUID.test(state.id) || !/^[a-f0-9]{64}$/.test(state.control_token)) throw new LaunchmateError('分享控制信息不合法。');
  const headers = { Authorization: 'Bearer ' + state.control_token };
  const status = await fetch(new URL('/status', origin), { headers, redirect: 'manual', signal: AbortSignal.timeout(1500) });
  const body = await status.text();
  if (body.length > 16384 || status.status !== 200) throw new Error('Share controller unavailable');
  const result = JSON.parse(body);
  if (result.id !== state.id) throw new Error('Share controller identity mismatch');
  if (action === 'verify') {
    try {
      const checked = await fetch(new URL('/verify', origin), { method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(12000) });
      if (checked.status !== 200) { await checked.body?.cancel(); throw new Error('Share recheck failed'); }
      const verified = await checked.json();
      if (verified.id !== state.id || verified.status !== 'active') throw new Error('Share controller identity mismatch');
      return verified;
    } catch { throw new LaunchmateError('原分享的应用或公网入口未通过重新检查；请恢复原服务后重试，或停止该分享。', { code: 'SHARE_VERIFICATION_FAILED' }); }
  }
  if (action === 'stop') {
    const stopped = await fetch(new URL('/stop', origin), { method: 'POST', headers, redirect: 'manual', signal: AbortSignal.timeout(1500) });
    if (stopped.status !== 200) throw new Error('Unable to stop this share');
    await stopped.body?.cancel();
  }
  return result;
}

export async function listShares(id) {
  if (id && !UUID.test(id)) throw new LaunchmateError('请使用 share 返回的完整分享 ID。');
  const root = await directory();
  const names = id ? [id + '.json'] : (await readdir(root)).filter((name) => UUID.test(name.slice(0, -5)) && name.endsWith('.json')).slice(0, 1000);
  const result = [];
  for (const name of names) {
    try {
      const state = await jsonFile(join(root, name));
      let value = publicState(state);
      if (['starting', 'active', 'stopping'].includes(state.status)) {
        try { value = await control(state); } catch { value.status = 'unreachable'; }
      }
      result.push(value);
    } catch (error) { if (id || error.code !== 'ENOENT') throw error; }
  }
  return { shares: result };
}

export async function stopShare(id) {
  if (!UUID.test(id || '')) throw new LaunchmateError('停止分享必须指定 --id 分享ID。');
  const root = await directory(); const state = await jsonFile(join(root, id + '.json'));
  if (['stopped', 'failed'].includes(state.status)) return publicState(state);
  try { await control(state, 'stop'); }
  catch { throw new LaunchmateError('原分享控制进程无法验证，未按旧 PID 结束任何进程。请检查原终端会话。', { code: 'SHARE_SESSION_UNREACHABLE' }); }
  return { id, status: 'stopping' };
}

export async function openShareSession({ fingerprint, target, protected: protectedShare, onStop, onVerify }) {
  const root = await directory(); const id = randomUUID();
  const path = join(root, id + '.json'); const lockPath = join(root, fingerprint + '.lock');
  const state = { id, fingerprint, target, protected: protectedShare, status: 'starting', pid: process.pid, created_at: new Date().toISOString(), control_token: randomBytes(32).toString('hex') };
  const controller = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
    if (!equalSecret(request.headers.authorization, 'Bearer ' + state.control_token)) { response.writeHead(403); response.end('{}'); return; }
    if (request.url === '/status' && request.method === 'GET') { response.end(JSON.stringify(publicState(state))); return; }
    if (request.url === '/verify' && request.method === 'POST') {
      if (state.status !== 'active' || !onVerify) { response.writeHead(409); response.end('{}'); return; }
      Promise.resolve().then(() => onVerify(publicState(state))).then((verification) => {
        if (state.status !== 'active') throw new Error('Share is stopping');
        response.end(JSON.stringify({ ...publicState(state), verification }));
      }).catch(() => { if (!response.destroyed) { response.writeHead(502); response.end('{"error":"SHARE_VERIFICATION_FAILED"}'); } });
      return;
    }
    if (request.url === '/stop' && request.method === 'POST') {
      state.status = 'stopping'; response.end('{"ok":true}'); response.once('finish', () => setImmediate(onStop)); return;
    }
    response.writeHead(404); response.end('{}');
  });
  await new Promise((resolve, reject) => { controller.once('error', reject); controller.listen(0, '127.0.0.1', resolve); });
  state.control_url = `http://127.0.0.1:${controller.address().port}/`;
  const closeController = () => { controller.closeAllConnections(); controller.close(); };
  let lock; let ownsLock = false;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { lock = await open(lockPath, 'wx', 0o600); ownsLock = true; break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const owner = await jsonFile(lockPath);
        if (!UUID.test(owner.id || '') || !Number.isInteger(owner.pid) || owner.pid <= 0) throw new LaunchmateError('分享锁记录不合法，未覆盖原记录。');
        try {
          const existing = await jsonFile(join(root, owner.id + '.json'));
          const live = await control(existing);
          if (live.status === 'active') { const verified = await control(existing, 'verify'); closeController(); return { reused: verified }; }
          throw new LaunchmateError(`分享 ${owner.id} 正在建立或结束，请用 share-status 查询。`, { code: 'SHARE_ALREADY_STARTING' });
        } catch (failure) {
          if (failure instanceof LaunchmateError) throw failure;
          let alive = true;
          try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
          if (alive) throw new LaunchmateError(`分享 ${owner.id} 的原进程仍存在但控制端未响应，未启动重复通道。`, { code: 'SHARE_SESSION_UNREACHABLE' });
          await unlink(lockPath);
        }
      }
    }
    if (!lock) throw new LaunchmateError('无法取得分享会话锁，请重试。');
    await lock.writeFile(JSON.stringify({ id, pid: process.pid })); await lock.close(); lock = null;
    async function save() {
      const temporary = path + '.' + randomUUID() + '.tmp';
      await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 }); await rename(temporary, path);
    }
    await save();
    return {
      id, token: state.control_token,
      async update(values) { Object.assign(state, values); await save(); return publicState(state); },
      async writePassword(password) { const file = join(root, id + '.password'); await writeFile(file, password + '\n', { flag: 'wx', mode: 0o600 }); state.password_file = file; await save(); return file; },
      async close(status) {
        try { state.status = status; await save(); }
        finally {
          closeController();
          const owner = await jsonFile(lockPath).catch(() => null);
          if (owner?.id === id) await unlink(lockPath).catch(() => {});
        }
      },
    };
  } catch (error) { await lock?.close(); if (ownsLock) await unlink(lockPath).catch(() => {}); closeController(); throw error; }
}
