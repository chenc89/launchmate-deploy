import { createServer } from 'node:http';
import { lstat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { resolveProjectDirectory } from './paths.js';
import { fail, safeFile, pathSegments, sendStaticFile } from './staticFiles.js';
import { LaunchmateError } from './errors.js';
import { publicPreviewPath, proxyPreview } from './previewProxy.js';
import { shareUrlConfig, SHARE_API_PATH, SHARE_ADAPTER_PATH } from './shareUrlAdapter.js';
import { shareBrowserScript } from './shareBrowserAdapter.js';
import { adaptShareHtml, MAX_ADAPTED_HTML } from './shareHtmlAdapter.js';

export function localPreviewUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new LaunchmateError('请提供已运行应用的本机 HTTP 网址。'); }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new LaunchmateError('--url 只接受带端口的本机 HTTP 根地址，例如 http://127.0.0.1:5173/。', { code: 'UNSAFE_SHARE_URL' });
  }
  // localhost 固定到回环，避免依赖系统解析或远端 DNS。
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url;
}

export async function createLocalPreview({ directory, url, apiUrl, apiPrefix = '/api', shareId, accessGuard }) {
  if (Boolean(directory) === Boolean(url)) throw new LaunchmateError('请在 --dir 和 --url 中选择一个分享目标。');
  if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(apiPrefix)) throw new LaunchmateError('接口前缀必须是 /api 这类非根路径。');
  let root; let upstream;
  const api = apiUrl ? localPreviewUrl(apiUrl) : null;
  if (directory) {
    root = await resolveProjectDirectory(directory);
    for (const name of ['package.json', 'composer.json', 'artisan']) {
      if (await lstat(join(root, name)).then(() => true, (error) => { if (error.code === 'ENOENT') return false; throw error; })) {
        throw new LaunchmateError('该目录是应用源码；请指定构建好的静态目录，或用 --url 分享已运行的应用。', { code: 'SOURCE_DIRECTORY' });
      }
    }
    const index = await safeFile(root, ['index.html']).catch(() => { throw new LaunchmateError('静态分享目录必须包含实际的 index.html。'); });
    await index.close();
  } else upstream = localPreviewUrl(url);
  const adapter = (upstream || api) ? shareUrlConfig(upstream, api, apiPrefix) : null;
  const server = createServer((request, response) => {
    handleRequest(request, response).catch(() => {
      if (response.destroyed) return;
      if (response.headersSent) response.destroy(); else fail(response, 400, '请求未能完成。');
    });
  });
  async function handleRequest(request, response) {
    response.setHeader('X-Launchmate-Preview', shareId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (!publicPreviewPath(request.url)) { fail(response, 404, '没有找到页面。'); return; }
    if (accessGuard && !(await accessGuard(request, response))) return;
    const rawPath = (request.url || '/').split('?')[0];
    if (adapter && rawPath === SHARE_ADAPTER_PATH) {
      if (!['GET', 'HEAD'].includes(request.method)) { fail(response, 405, '适配脚本仅支持读取。'); return; }
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(request.method === 'HEAD' ? undefined : shareBrowserScript(adapter));
      return;
    }
    if (rawPath === SHARE_API_PATH || rawPath.startsWith(SHARE_API_PATH + '/')) {
      if (!api) { fail(response, 404, '本次分享未配置独立后端。'); return; }
      request.url = request.url.slice(SHARE_API_PATH.length) || '/';
      if (request.url.startsWith('?')) request.url = '/' + request.url;
      if (!publicPreviewPath(request.url) || request.url.startsWith('//')) { fail(response, 404, '接口路径不合法。'); return; }
      proxyPreview(request, response, api, { adapter, backend: true });
      return;
    }
    const pathname = decodeURIComponent((request.url || '/').split('?')[0]);
    const target = api && (pathname === apiPrefix || pathname.startsWith(apiPrefix + '/')) ? api : upstream;
    if (target) { proxyPreview(request, response, target, { adapter, backend: target === api }); return; }
    const segments = pathSegments(request.url || '/');
    if (!segments || segments.some((part) => ['work', 'storage', 'backend', 'config', 'database', 'backups'].includes(part))) { fail(response, 404, '没有找到文件。'); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('Allow', 'GET, HEAD'); fail(response, 405, '静态分享仅支持读取。'); return; }
    let handle;
    try {
      const requested = segments.length ? segments : ['index.html'];
      let filename = requested.at(-1);
      try { handle = await safeFile(root, requested); }
      catch (error) {
        if (extname(filename) || !String(request.headers.accept || '').includes('text/html')) throw error;
        filename = 'index.html'; handle = await safeFile(root, [filename]);
      }
      const htmlAdapter = adapter ? (bytes) => adaptShareHtml(bytes, adapter) : undefined;
      if (htmlAdapter && /\.html?$/i.test(filename) && (await handle.stat()).size > MAX_ADAPTED_HTML) throw new LaunchmateError('页面超过 8 MiB，无法进行本次浏览器地址适配。', { code: 'SHARE_HTML_TOO_LARGE' });
      await sendStaticFile(request, response, handle, filename, 'no-store', htmlAdapter);
    } catch (error) {
      if (response.headersSent) response.destroy(); else fail(response, error instanceof LaunchmateError ? 502 : 404, error instanceof LaunchmateError ? error.message : '没有找到文件。');
    } finally { await handle?.close().catch(() => {}); }
  }
  server.on('upgrade', (request, socket) => socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n'));
  return server;
}
