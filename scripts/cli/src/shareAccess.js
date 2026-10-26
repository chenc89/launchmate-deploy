import { randomBytes, timingSafeEqual } from 'node:crypto';
import { LaunchmateError } from './errors.js';

export function equalSecret(left, right) {
  const a = Buffer.from(left || ''); const b = Buffer.from(right || '');
  return a.length === b.length && timingSafeEqual(a, b);
}

const escape = (text) => text.replace(/[&<>"']/g, (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]);

export function createShareAccess({ password, verificationToken, checkPaths }) {
  if (password && (Buffer.byteLength(password) < 12 || Buffer.byteLength(password) > 256)) throw new LaunchmateError('分享密码需为 12–256 字节，请通过 LAUNCHMATE_SHARE_PASSWORD 配置。', { code: 'SHARE_PASSWORD_INVALID' });
  const name = 'lm_preview_' + randomBytes(8).toString('hex');
  const session = randomBytes(32).toString('base64url');
  let attempts = 0; let resetAt = 0;
  return async function access(request, response) {
    if (!password) return true;
    const url = new URL(request.url, 'http://preview.local');
    if (['GET', 'HEAD'].includes(request.method) && checkPaths.includes(url.pathname) && equalSecret(request.headers['x-launchmate-check'], verificationToken)) return true;
    const cookies = (request.headers.cookie || '').split(';').map((part) => part.trim());
    const authenticated = cookies.some((part) => part.startsWith(name + '=') && equalSecret(part.slice(name.length + 1), session));
    if (authenticated) {
      request.headers.cookie = cookies.filter((part) => !part.startsWith(name + '=')).join('; ');
      return true;
    }
    const suppliedNext = url.searchParams.get('next') || '/';
    const next = suppliedNext.startsWith('/') && !suppliedNext.startsWith('//') && !/[\r\n\\]/.test(suppliedNext) ? suppliedNext : '/';
    if (url.pathname === '/__launchmate_share/login') {
      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      if (request.method === 'POST') {
        if (Date.now() > resetAt) { attempts = 0; resetAt = Date.now() + 60000; }
        if (attempts >= 10) { response.writeHead(429, { 'Retry-After': '60' }); response.end('尝试过于频繁，请稍后再试。'); return false; }
        if (!String(request.headers['content-type']).startsWith('application/x-www-form-urlencoded')) { response.writeHead(415); response.end(); return false; }
        const chunks = []; let bytes = 0;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 4096) { response.writeHead(413); response.end(); return false; }
          chunks.push(chunk);
        }
        const form = new URLSearchParams(Buffer.concat(chunks).toString());
        if (!equalSecret(form.get('password'), password)) { attempts++; response.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('预览密码不正确。'); return false; }
        attempts = 0;
        response.setHeader('Set-Cookie', `${name}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`);
        response.writeHead(303, { Location: next }); response.end(); return false;
      }
      if (request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>访问此预览</title><style>body{font:16px system-ui;background:#f5f6fa;margin:0;padding:10vh 24px}main{max-width:360px;margin:auto;background:white;padding:32px;border-radius:16px}input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;font:inherit}button{background:#5646df;color:white;border:0;border-radius:8px}p{color:#555}</style><main><h1>访问此预览</h1><p>请输入分享者提供的预览密码。</p><form method="post" action="/__launchmate_share/login?next=${escape(encodeURIComponent(next))}"><label for="password">预览密码</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>打开预览</button></form></main></html>`); return false;
      }
      response.writeHead(405); response.end(); return false;
    }
    if (request.method !== 'GET' || String(request.headers.accept).includes('application/json')) {
      response.writeHead(401, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { code: 'SHARE_PASSWORD_REQUIRED', message: '请先通过预览密码验证。' } }));
    } else { response.writeHead(303, { Location: '/__launchmate_share/login?next=' + encodeURIComponent(request.url) }); response.end(); }
    return false;
  };
}
