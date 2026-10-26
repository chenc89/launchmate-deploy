import { open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { isPrivatePath } from './paths.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject', '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

export function fail(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(message);
}

/** Resolve only regular files in a published release. Symlinks are never served. */
export async function safeFile(root, segments) {
  let path = root;
  for (let index = 0; index < segments.length; index += 1) {
    path = join(path, segments[index]);
    const info = await lstat(path);
    if (info.isSymbolicLink() || (index < segments.length - 1 && !info.isDirectory())) {
      throw new Error('Unsafe published file');
    }
    if (index === segments.length - 1 && !info.isFile()) throw new Error('Not a published file');
  }
  const absolute = await realpath(path);
  const canonicalRoot = await realpath(root);
  const child = relative(canonicalRoot, absolute);
  if (child === '..' || child.startsWith(`..${sep}`) || resolve(canonicalRoot, child) !== absolute) {
    throw new Error('Published file outside root');
  }
  return open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
}

export function pathSegments(requestUrl) {
  let path;
  try { path = decodeURIComponent(requestUrl.split('?')[0]); } catch { return null; }
  if (!path.startsWith('/') || /[\x00-\x1f\x7f\\]/.test(path)) return null;
  const segments = path.split('/').filter(Boolean);
  if (segments.some((part) => part === '.' || part === '..' || part.startsWith('.')) || isPrivatePath(path)) return null;
  if (segments.some((part) => ['package.json', 'composer.json', 'launchmate.backend.json', 'node_modules', 'vendor', '_headers', '_redirects'].includes(part))) return null;
  return segments;
}


/** 共用静态文件响应，保留二进制与音视频 Range 支持。 */
export async function sendStaticFile(request, response, handle, filename, cacheControl = 'no-store', adaptHtml) {
  const type = TYPES[extname(filename).toLowerCase()];
  if (!type) throw new Error('Unsupported published file');
  const info = await handle.stat();
  if (!info.isFile()) throw new Error('Not a published file');
  const headers = {
    'Content-Type': type,
    'Content-Length': info.size,
    'Cache-Control': cacheControl,
    'Last-Modified': info.mtime.toUTCString(),
  };
  if (adaptHtml && type.startsWith('text/html')) {
    const body = adaptHtml(await handle.readFile());
    headers['Content-Length'] = body.length;
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : body);
    return;
  }
  let range;
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!match || (!match[1] && !match[2]) || info.size === 0) {
      response.setHeader('Content-Range', `bytes */${info.size}`);
      fail(response, 416, '无效的文件范围。');
      return;
    }
    const start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      response.setHeader('Content-Range', `bytes */${info.size}`);
      fail(response, 416, '无效的文件范围。');
      return;
    }
    range = { start, end };
    headers['Content-Length'] = end - start + 1;
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  }
  headers['Accept-Ranges'] = 'bytes';
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = handle.createReadStream({ ...range, autoClose: false });
  await new Promise((resolveStream, rejectStream) => {
    stream.once('error', rejectStream);
    response.once('close', () => { stream.destroy(); resolveStream(); });
    response.once('finish', resolveStream);
    stream.pipe(response);
  });
}
