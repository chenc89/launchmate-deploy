import { request as httpRequest } from 'node:http';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { isPrivatePath } from './paths.js';
import { fail } from './staticFiles.js';
import { adaptShareHtml, MAX_ADAPTED_HTML } from './shareHtmlAdapter.js';
import { mapShareUrl, backendSharePath, SHARE_API_PATH } from './shareUrlAdapter.js';

export function publicPreviewPath(requestUrl) {
  let decoded;
  try { decoded = decodeURIComponent((requestUrl || '/').split('?')[0]); } catch { return false; }
  const parts = decoded.split('/').filter(Boolean);
  return decoded.startsWith('/') && !decoded.startsWith('//') && !/[\x00-\x1f\x7f\\]|%[a-f0-9]{2}/i.test(decoded)
    && !parts.some((part) => part.startsWith('.') && !(part === '.vite' && parts[0] === 'node_modules'))
    && !isPrivatePath(decoded)
    && !parts.some((part) => ['@fs', '__open-in-editor', 'package.json', 'composer.json', 'launchmate.backend.json'].includes(part));
}

function localRequestHeaders(request, upstream) {
  const headers = { ...request.headers, host: upstream.host, 'accept-encoding': 'identity' };
  for (const name of ['connection', 'upgrade', 'proxy-authorization', 'proxy-connection', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'x-launchmate-check']) delete headers[name];
  for (const name of ['origin', 'referer']) {
    if (!headers[name]) continue;
    try {
      const value = new URL(headers[name]);
      if (['http:', 'https:'].includes(value.protocol) && value.host === request.headers.host) {
        const path = value.pathname.startsWith(SHARE_API_PATH + '/') ? value.pathname.slice(SHARE_API_PATH.length) : value.pathname;
        headers[name] = name === 'origin' ? upstream.origin : upstream.origin + path + value.search;
      }
    } catch { /* 外部或非法来源保持原样，由应用的 CSRF 规则拒绝。 */ }
  }
  return headers;
}

async function readHtml(incoming) {
  const encoding = (incoming.headers['content-encoding'] || 'identity').toLowerCase();
  const decoder = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress }[encoding]?.();
  if (encoding !== 'identity' && !decoder) throw new Error('上游页面使用了不支持的压缩方式。');
  const stream = decoder || incoming;
  if (decoder) { incoming.on('error', (error) => decoder.destroy(error)); incoming.pipe(decoder); }
  const chunks = []; let size = 0;
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > MAX_ADAPTED_HTML) throw new Error('页面超过 8 MiB，无法进行分享适配。');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally { if (decoder) decoder.destroy(); }
}

/** 固定目标的 HTTP 转发；仅当前分享入口的来源映射回本机应用。 */
export function proxyPreview(request, response, upstream, { adapter, backend = false } = {}) {
  const headers = localRequestHeaders(request, upstream);
  // HTML 适配必须取得完整响应；脚本和业务 JSON 保持原字节。
  delete headers['if-none-match']; delete headers['if-modified-since'];
  const proxy = httpRequest(upstream, { method: request.method, path: request.url, headers, timeout: 15000 }, (incoming) => {
    const html = adapter && /^text\/html(?:;|$)/i.test(incoming.headers['content-type'] || '') && ![204, 304].includes(incoming.statusCode);
    async function forward() {
      let body;
      if (html && request.method !== 'HEAD') {
        if (incoming.statusCode === 206) throw new Error('上游返回分段 HTML，无法安全进行分享适配。');
        if (/charset\s*=\s*(?!utf-8\b|utf8\b|us-ascii\b)/i.test(incoming.headers['content-type'])) throw new Error('分享页面需要 UTF-8 编码。');
        const pageAdapter = backend ? { ...adapter, document_url: new URL(request.url, upstream).href } : adapter;
        body = adaptShareHtml(await readHtml(incoming), pageAdapter, incoming.headers['content-security-policy']);
      }
      for (const [name, original] of Object.entries(incoming.headers)) {
        if (original === undefined || ['connection', 'transfer-encoding', 'x-launchmate-preview', 'cache-control'].includes(name)) continue;
        if (html && ['content-length', 'content-encoding', 'etag', 'last-modified', 'content-md5', 'digest', 'content-digest', 'accept-ranges'].includes(name)) continue;
        let value = original;
        if (name === 'location') {
          let location;
          try { location = new URL(value, new URL(request.url, upstream)); } catch { /* 非标准跳转保留原值。 */ }
          if (location) {
            if (adapter) value = mapShareUrl(location.href, adapter);
            else if (location.origin === upstream.origin) value = location.pathname + location.search + location.hash;
          }
        }
        if (name === 'set-cookie') value = original.map((cookie) => {
          const hostOnly = cookie.replace(/;\s*Domain=\.?([^;]+)/ig, (part, domain) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(domain.toLowerCase()) ? '' : part);
          return backend && adapter ? hostOnly.replace(/;\s*Path=([^;]+)/i, (part, path) => path === '/' ? part : '; Path=' + backendSharePath(path, adapter)) : hostOnly;
        });
        response.setHeader(name, value);
      }
      response.statusCode = incoming.statusCode;
      if (body) { response.setHeader('Content-Length', body.length); response.end(body); return; }
      incoming.on('error', () => response.destroy());
      incoming.pipe(response);
    }
    forward().catch((error) => { incoming.destroy(); if (response.headersSent) response.destroy(); else fail(response, 502, error.message || '分享页面无法适配。'); });
  });
  proxy.on('timeout', () => proxy.destroy(new Error('Preview upstream timeout')));
  proxy.on('error', () => { if (response.headersSent) response.destroy(); else fail(response, 502, '本机应用暂时无法访问。'); });
  request.on('aborted', () => proxy.destroy()); request.on('error', () => proxy.destroy());
  response.on('close', () => proxy.destroy());
  request.pipe(proxy);
}
