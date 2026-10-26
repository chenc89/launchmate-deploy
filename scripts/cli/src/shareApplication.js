import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalPreview, localPreviewUrl } from './localPreview.js';
import { resolveProjectDirectory, isInsideDirectory } from './paths.js';
import { createQuickTunnel } from './quickTunnel.js';
import { LaunchmateError, redactSecrets } from './errors.js';
import { checkPreviewPath, checkPreview, assertPreviewReady } from './previewChecks.js';
import { createShareAccess } from './shareAccess.js';
import { openShareSession, shareStateDirectory } from './shareSessions.js';

/** 持有本次代理与通道，业务服务和数据库始终由原应用管理。 */
export async function shareApplication({ directory, url, apiUrl, apiPrefix = '/api', checkPath = '/', apiCheckPath, protected: protectedShare = false, cloudflared, confirmShare = false, onReady = () => {}, onProgress = () => {}, fetchImpl = globalThis.fetch }) {
  if (confirmShare !== true) throw new LaunchmateError('需要用户明确要求分享此本地应用。', { code: 'SHARE_CONFIRMATION_REQUIRED' });
  if (Boolean(directory) === Boolean(url)) throw new LaunchmateError('请在 --dir 和 --url 中选择一个分享目标。');
  const root = directory ? await resolveProjectDirectory(directory) : null;
  const origin = url ? localPreviewUrl(url).href : null;
  const apiOrigin = apiUrl ? localPreviewUrl(apiUrl).href : null;
  if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(apiPrefix)) throw new LaunchmateError('接口前缀必须是 /api 这类非根路径。');
  const paths = [checkPreviewPath(checkPath)];
  if (apiOrigin) {
    const health = checkPreviewPath(apiCheckPath || apiPrefix + '/health');
    if (health !== apiPrefix && !health.startsWith(apiPrefix + '/')) throw new LaunchmateError('接口健康检查路径必须位于配置的接口前缀下。');
    if (!paths.includes(health)) paths.push(health);
  } else if (apiCheckPath) throw new LaunchmateError('--api-check-path 需要同时指定 --api-url。');
  const cache = resolve(shareStateDirectory());
  if (root && (cache === root || isInsideDirectory(root, cache))) throw new LaunchmateError('分享状态和密码目录必须位于公开静态目录之外。');
  const configuredPassword = protectedShare ? process.env.LAUNCHMATE_SHARE_PASSWORD : null;
  const password = protectedShare ? (configuredPassword || randomBytes(18).toString('base64url')) : null;
  const verificationToken = randomBytes(32).toString('hex');
  const guard = createShareAccess({ password, verificationToken, checkPaths: paths });
  const fingerprint = createHash('sha256').update(JSON.stringify({ adapter_version: 2, root, origin, apiOrigin, apiPrefix, paths, protectedShare, password: configuredPassword ? createHash('sha256').update(configuredPassword).digest('hex') : 'generated' })).digest('hex');
  let server; let child; let stopping = false; let failure; let timeout;
  const abort = new AbortController(); let resolveStopped;
  const stopped = new Promise((resolveStop) => { resolveStopped = resolveStop; });
  function stop() {
    if (stopping) return;
    stopping = true; abort.abort(); child?.kill('SIGTERM');
    server?.closeAllConnections(); server?.close(); resolveStopped();
  }
  const session = await openShareSession({
    fingerprint, target: { directory: root, url: origin, api_url: apiOrigin, api_prefix: apiOrigin ? apiPrefix : null, check_paths: paths }, protected: protectedShare, onStop: stop,
    onVerify: async (state) => {
      const headers = { 'X-Launchmate-Check': verificationToken };
      const checks = await Promise.all(paths.map(async (path) => {
        const local = await checkPreview(state.local_url, path, headers); assertPreviewReady(local);
        const remote = await checkPreview(state.url, path, headers, fetchImpl);
        if (local.preview_id !== state.id || remote.preview_id !== state.id || remote.http_status !== local.http_status) throw new Error('Share recheck failed');
        const { preview_id, ...result } = local;
        return result;
      }));
      return { http: 'passed', business: 'not_checked', checks };
    },
  });
  if (session.reused) { onReady({ mode: 'standalone-share', ...session.reused, verified: true, reused: true }); return; }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
  try {
    if (protectedShare && !configuredPassword) await session.writePassword(password);
    server = await createLocalPreview({ directory: root, url: origin, apiUrl: apiOrigin, apiPrefix, shareId: session.id, accessGuard: guard });
    if (stopping) return;
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
    const localUrl = `http://127.0.0.1:${server.address().port}/`;
    const headers = { 'X-Launchmate-Check': verificationToken };
    const checks = [];
    for (const path of paths) { const result = await checkPreview(localUrl, path, headers); assertPreviewReady(result); checks.push(result); }
    await session.update({ local_url: localUrl });
    onProgress('本机页面与接口检查完成，正在连接公网。');
    child = await createQuickTunnel({ origin: localUrl, binary: cloudflared });
    if (stopping) { child.kill('SIGTERM'); return; }
    let resolveUrl; let output = '';
    const publicUrl = new Promise((resolvePublic) => { resolveUrl = resolvePublic; });
    const log = (chunk) => {
      onProgress(redactSecrets(chunk.toString()).trimEnd());
      output = (output + chunk.toString()).slice(-16384);
      const found = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/.exec(output);
      if (found) resolveUrl(found[0] + '/');
    };
    child.stdout.on('data', log); child.stderr.on('data', log);
    child.once('error', (error) => { failure = error; stop(); });
    child.once('exit', (code) => { if (!stopping) { failure = new LaunchmateError(`分享通道已退出（${code}）。`, { code: 'SHARE_TUNNEL_EXITED' }); stop(); } });
    timeout = setTimeout(() => { failure = new LaunchmateError('公网连接或验收超时，请检查网络后重试。', { code: 'SHARE_TIMEOUT' }); stop(); }, 60000);
    const address = await Promise.race([publicUrl, stopped]);
    if (!address) { if (failure) throw failure; return; }
    let verified = false;
    for (let attempt = 0; attempt < 15 && !stopping; attempt++) {
      try {
        const publicChecks = await Promise.all(paths.map((path) => checkPreview(address, path, headers, fetchImpl, abort.signal)));
        verified = publicChecks.every((item, index) => item.preview_id === session.id && item.http_status === checks[index].http_status);
        if (verified) break;
      } catch { if (stopping) break; }
      await delay(2000, undefined, { signal: abort.signal }).catch(() => {});
    }
    if (!verified) { if (stopping && !failure) return; throw failure || new LaunchmateError('公网验收未能确认此应用，分享已停止。', { code: 'SHARE_VERIFICATION_FAILED' }); }
    if (stopping) { if (failure) throw failure; return; }
    clearTimeout(timeout);
    const verification = { http: 'passed', business: 'not_checked', checks: checks.map(({ preview_id, ...result }) => result) };
    const state = await session.update({ status: 'active', url: address, verification });
    if (stopping) return;
    onReady({ mode: 'standalone-share', ...state, verified: true, reused: false, pid: process.pid });
    await stopped;
    if (failure) throw failure;
  } catch (error) {
    if (!stopping || failure) { failure ||= error; throw failure; }
  } finally {
    clearTimeout(timeout); stop();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, stop);
    if (child && child.exitCode === null && child.signalCode === null) {
      await Promise.race([new Promise((resolveExit) => child.once('exit', resolveExit)), delay(3000, undefined, { ref: false })]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await session.close(failure ? 'failed' : 'stopped');
  }
}
