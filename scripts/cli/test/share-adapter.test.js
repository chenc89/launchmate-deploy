import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { createLocalPreview } from '../src/localPreview.js';
import { shareUrlConfig, mapShareUrl, SHARE_API_PATH, SHARE_ADAPTER_PATH } from '../src/shareUrlAdapter.js';
import { shareBrowserScript } from '../src/shareBrowserAdapter.js';
import { adaptShareHtml } from '../src/shareHtmlAdapter.js';

async function listen(t, server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/`;
}

function browser(config, base, nativeFetch) {
  const opened = [];
  class Xhr { open(...args) { opened.push({ receiver: this, args }); } }
  class NodeElement { setAttribute(name, value) { this[name] = value; } }
  class ImageElement {}
  Object.defineProperty(ImageElement.prototype, 'src', { configurable: true, get() { return this.value; }, set(value) { this.value = value; } });
  const window = { location: { href: base }, fetch: nativeFetch, HTMLImageElement: ImageElement };
  runInNewContext(shareBrowserScript(config), { window, URL, Request, XMLHttpRequest: Xhr, Element: NodeElement });
  return { window, Xhr, NodeElement, ImageElement, opened };
}

function getRaw(origin, path) {
  return new Promise((resolve, reject) => {
    const outgoing = request(origin, { path }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }));
    });
    outgoing.on('error', reject); outgoing.end();
  });
}

test('URL adaptation selects only the configured services and keeps API and backend paths distinct', () => {
  const config = shareUrlConfig(new URL('http://127.0.0.1:5173/'), new URL('http://127.0.0.1:8000/'));
  assert.equal(mapShareUrl('http://localhost:5173/assets/main.js', config), '/assets/main.js');
  assert.equal(mapShareUrl('http://localhost:8000/api/notes?q=a%20b#item', config), '/api/notes?q=a%20b#item');
  assert.equal(mapShareUrl('//127.0.0.1:8000/auth/login', config), SHARE_API_PATH + '/auth/login');
  assert.equal(mapShareUrl('http://[::1]:8000/files/one.png', config), SHARE_API_PATH + '/files/one.png');
  assert.equal(mapShareUrl('/api/notes', config), '/api/notes');
  assert.equal(mapShareUrl('https://example.com/api/notes', config), 'https://example.com/api/notes');
  assert.throws(() => mapShareUrl('http://localhost:2375/containers/json', config), /未包含/);
  assert.throws(() => mapShareUrl('http://user:secret@localhost:8000/api/notes', config), /凭据/);
  assert.throws(() => mapShareUrl('http://localhost:8000//outside.example/data', config), /双斜线/);
});

test('URL normalization handles whitespace before applying the local-port allowlist', () => {
  const config = shareUrlConfig(new URL('http://127.0.0.1:5173/'), new URL('http://127.0.0.1:8000/'));
  for (const address of ['  http://localhost:8000/api/notes ', '\thttp://localhost:8000/api/notes\r\n', 'ht\ttp://localhost:8000/api/notes']) {
    assert.equal(mapShareUrl(address, config), '/api/notes');
  }
  assert.throws(() => mapShareUrl('\thttp://localhost:2375/containers/json', config), /未包含/);
  assert.equal(mapShareUrl('/api/notes', config, 'http://127.0.0.1:9000/'), '/api/notes');
  const external = '  https://example.com/api/notes ';
  assert.equal(mapShareUrl(external, config), external);
  assert.equal(mapShareUrl('http://[', config), 'http://[');
});

test('HTML adaptation changes actual URL attributes without changing quoted text in other attributes', () => {
  const config = shareUrlConfig(null, new URL('http://127.0.0.1:8000/'));
  const description = `alt="example src='http://localhost:8000/image.png'" data-info='sample href="http://localhost:9999/private"'`;
  const source = `<html><head><script data-info="nonce='wrong'" nonce="real">start()</script></head><body><img ${description} src="  http://localhost:8000/image.png "></body></html>`;
  const result = adaptShareHtml(Buffer.from(source), config, "script-src 'nonce-real'; connect-src 'self'").toString();
  assert.ok(result.includes(description));
  assert.ok(result.includes(`src="${SHARE_API_PATH}/image.png"`));
  assert.ok(result.includes(`src="${SHARE_ADAPTER_PATH}" nonce="real"`));
});

test('backend documents retain their own root-relative forms, scripts and browser requests', async (t) => {
  const frontend = await listen(t, createServer((req, res) => { res.statusCode = req.url === '/' ? 200 : 404; res.end(req.url === '/' ? 'frontend' : 'wrong frontend route'); }));
  const api = await listen(t, createServer(async (req, res) => {
    if (req.url === '/auth/login' && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><head><script src="/assets/auth.js"></script><link href="styles.css" rel="stylesheet"></head><body><form action="/auth/login" method="post"></form></body></html>');
    } else if (req.url === '/auth/login' && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ received: Buffer.concat(chunks).toString() }));
    } else if (req.url === '/assets/auth.js' || req.url === '/auth/styles.css') res.end('backend asset');
    else { res.statusCode = 404; res.end('missing'); }
  }));
  const preview = await listen(t, await createLocalPreview({ url: frontend, apiUrl: api, shareId: 'backend-document' }));
  const pageUrl = new URL(SHARE_API_PATH + '/auth/login', preview).href;
  const html = await (await fetch(pageUrl)).text();
  assert.ok(html.includes(`action="${SHARE_API_PATH}/auth/login"`));
  assert.ok(html.includes(`src="${SHARE_API_PATH}/assets/auth.js"`));
  assert.ok(html.includes(`href="${SHARE_API_PATH}/auth/styles.css"`));
  assert.equal(await (await fetch(new URL(SHARE_API_PATH + '/assets/auth.js', preview))).text(), 'backend asset');
  const posted = await fetch(new URL(SHARE_API_PATH + '/auth/login', preview), { method: 'POST', body: 'email=test%40example.test' });
  assert.equal((await posted.json()).received, 'email=test%40example.test');
  const config = shareUrlConfig(new URL(frontend), new URL(api));
  assert.equal(mapShareUrl('/auth/login', config, pageUrl), SHARE_API_PATH + '/auth/login');
  assert.equal(mapShareUrl('styles.css', config, pageUrl), SHARE_API_PATH + '/auth/styles.css');
  assert.equal(mapShareUrl(SHARE_API_PATH + '/assets/auth.js', config, pageUrl), SHARE_API_PATH + '/assets/auth.js');
  const adapter = browser(config, pageUrl, (input, init) => fetch(input instanceof Request ? input : new URL(input, pageUrl), init));
  assert.equal((await (await adapter.window.fetch('/auth/login', { method: 'POST', body: 'from=browser' })).json()).received, 'from=browser');
  assert.equal((await (await adapter.window.fetch(new Request(new URL('/auth/login', pageUrl), { method: 'POST', body: 'from=request' }))).json()).received, 'from=request');
  const image = new adapter.ImageElement(); image.src = '/assets/auth.js';
  assert.equal(image.src, SHARE_API_PATH + '/assets/auth.js');
  assert.equal(await (await fetch(preview)).text(), 'frontend');
  const withBase = adaptShareHtml(Buffer.from('<html><head><base href="/auth/assets/"><script src="start.js"></script></head></html>'), { ...config, document_url: new URL('/auth/login', api).href }).toString();
  assert.ok(withBase.includes(`href="${SHARE_API_PATH}/auth/assets/"`));
  assert.ok(withBase.includes(`src="${SHARE_API_PATH}/auth/assets/start.js"`));
});

test('browser fetch adaptation preserves Request methods, headers, credentials, abort and multipart bodies', async (t) => {
  const received = [];
  const api = await listen(t, createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    received.push({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.setHeader('Content-Type', 'application/json'); res.end('{"saved":true}');
  }));
  const preview = await listen(t, await createLocalPreview({ url: api, apiUrl: api, shareId: 'adapter-fetch' }));
  const config = shareUrlConfig(null, new URL(api));
  const sent = [];
  const adapter = browser(config, preview, (input, init) => {
    const outgoing = input instanceof Request ? new Request(input, init) : new Request(new URL(input, preview), init);
    sent.push(outgoing); return fetch(outgoing);
  });
  const origin = api.replace('127.0.0.1', 'localhost');
  await adapter.window.fetch(origin + 'api/string');
  await adapter.window.fetch(new URL(origin + 'api/url'));
  const original = new Request(origin + 'api/request', { method: 'POST', headers: { Authorization: 'Bearer app-only', 'Content-Type': 'application/json' }, body: '{"note":"unchanged"}', credentials: 'include', redirect: 'manual' });
  await adapter.window.fetch(original);
  assert.deepEqual(received.slice(0, 3).map((entry) => [entry.path, entry.method]), [['/api/string', 'GET'], ['/api/url', 'GET'], ['/api/request', 'POST']]);
  assert.equal(received[2].headers.authorization, 'Bearer app-only');
  assert.equal(received[2].body, '{"note":"unchanged"}');
  assert.equal(sent[2].credentials, 'include'); assert.equal(sent[2].redirect, 'manual');
  assert.equal(new URL(sent[2].url).origin, new URL(preview).origin);

  const form = new FormData(); form.append('title', 'multipart title'); form.append('file', new Blob(['original upload bytes'], { type: 'text/plain' }), 'note.txt');
  await adapter.window.fetch(new Request(origin + 'api/files', { method: 'POST', body: form, headers: { 'X-CSRF-TOKEN': 'csrf-test' } }), { credentials: 'include' });
  const upload = received.at(-1);
  assert.equal(upload.headers['x-csrf-token'], 'csrf-test');
  assert.match(upload.headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.match(upload.body, /name="title"\r\n\r\nmultipart title/);
  assert.match(upload.body, /filename="note.txt"/); assert.match(upload.body, /original upload bytes/);
  await adapter.window.fetch(origin + 'api/files-direct', { method: 'POST', body: form, headers: { 'X-CSRF-TOKEN': 'csrf-direct' } });
  assert.match(received.at(-1).headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.equal(received.at(-1).headers['x-csrf-token'], 'csrf-direct');

  const abort = new AbortController(); abort.abort();
  await assert.rejects(adapter.window.fetch(new Request(origin + 'api/aborted', { signal: abort.signal })), { name: 'AbortError' });
  assert.ok(!received.some((entry) => entry.path === '/api/aborted'));
  const calls = sent.length;
  await assert.rejects(adapter.window.fetch('http://localhost:2375/containers/json'), /未包含/);
  assert.equal(sent.length, calls);
});

test('XHR and DOM URL setters use the same allowlist without forwarding unknown local ports', () => {
  const config = shareUrlConfig(new URL('http://127.0.0.1:5173/'), new URL('http://127.0.0.1:8000/'));
  const adapter = browser(config, 'https://example.test/', () => assert.fail('fetch must not run'));
  const xhr = new adapter.Xhr(); xhr.open('POST', 'http://localhost:8000/auth/login', false, 'user', 'pass');
  assert.equal(adapter.opened[0].receiver, xhr);
  assert.deepEqual(adapter.opened[0].args, ['POST', SHARE_API_PATH + '/auth/login', false, 'user', 'pass']);
  assert.throws(() => xhr.open('GET', 'http://localhost:9999/admin'), /未包含/);
  assert.equal(adapter.opened.length, 1);
  const node = new adapter.NodeElement(); node.setAttribute('src', 'http://localhost:8000/files/one.png');
  assert.equal(node.src, SHARE_API_PATH + '/files/one.png');
  node.setAttribute('data-note', 'http://localhost:9999/private'); assert.equal(node['data-note'], 'http://localhost:9999/private');
  const image = new adapter.ImageElement(); image.src = 'http://127.0.0.1:8000/files/two.png';
  assert.equal(image.src, SHARE_API_PATH + '/files/two.png');
});

test('static sharing adapts HTML while source files, script integrity and business JSON remain unchanged', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'launchmate-adapter-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const api = await listen(t, createServer((req, res) => res.end('api')));
  const javascript = `fetch(${JSON.stringify(api.replace('127.0.0.1', 'localhost') + 'api/notes')});`;
  const integrity = 'sha256-' + createHash('sha256').update(javascript).digest('base64');
  const files = {
    'index.html': `<!doctype html><html><head><meta charset="utf-8"><script src="/app.js" integrity="${integrity}"></script></head><body><a href="${api}files/one.png">下载</a><script>const note="http://localhost:9999/plain-text";</script></body></html>`,
    'app.js': javascript,
    'data.json': '{"note":"http://localhost:9999/user-written-text"}',
  };
  const originals = new Map();
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, name), content);
    originals.set(name, { hash: createHash('sha256').update(content).digest('hex'), mtime: (await stat(join(root, name))).mtimeMs });
  }
  const preview = await listen(t, await createLocalPreview({ directory: root, apiUrl: api, shareId: 'adapter-static' }));
  const html = await (await fetch(preview)).text();
  assert.ok(html.indexOf(SHARE_ADAPTER_PATH) < html.indexOf('/app.js'));
  assert.ok(html.includes(integrity)); assert.ok(html.includes('const note="http://localhost:9999/plain-text"'));
  assert.ok(html.includes(`href="${SHARE_API_PATH}/files/one.png"`));
  assert.equal(await (await fetch(preview + 'app.js')).text(), javascript);
  assert.equal(await (await fetch(preview + 'data.json')).text(), files['data.json']);
  assert.match((await fetch(preview + SHARE_ADAPTER_PATH.slice(1))).headers.get('content-type'), /javascript/);
  for (const [name, original] of originals) {
    assert.equal(createHash('sha256').update(await readFile(join(root, name))).digest('hex'), original.hash);
    assert.equal((await stat(join(root, name))).mtimeMs, original.mtime);
  }
});

test('HTML adaptation respects both header and meta CSP and never runs before a late policy', () => {
  const config = shareUrlConfig(null, new URL('http://127.0.0.1:8000/'));
  const html = Buffer.from('<!doctype html><html><head><script src="/app.js"></script></head></html>');
  const policy = "script-src 'self'; connect-src 'self'";
  assert.ok(adaptShareHtml(html, config, policy).toString().includes(SHARE_ADAPTER_PATH));
  assert.throws(() => adaptShareHtml(html, config, "script-src 'none'; connect-src 'self'"), { code: 'SHARE_ADAPTER_CSP' });
  assert.throws(() => adaptShareHtml(html, config, "SCRIPT-SRC 'none'; CONNECT-SRC 'self'"), { code: 'SHARE_ADAPTER_CSP' });
  assert.throws(() => adaptShareHtml(html, config, "script-src 'self'; CONNECT-SRC 'none'"), { code: 'SHARE_ADAPTER_CSP' });
  assert.throws(() => adaptShareHtml(html, config, "script-src 'self'; connect-src http://localhost:8000"), { code: 'SHARE_ADAPTER_CSP' });
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const safe = adaptShareHtml(Buffer.from(`<html><head>${meta}<script src="/app.js"></script></head></html>`), config).toString();
  assert.ok(safe.indexOf(meta) < safe.indexOf(SHARE_ADAPTER_PATH));
  assert.throws(() => adaptShareHtml(Buffer.from(`<html><head><script src="/app.js"></script>${meta}</head></html>`), config), { code: 'SHARE_ADAPTER_CSP' });
  const inert = `<!-- <script>comment</script> --><template><meta http-equiv="Content-Security-Policy" content="script-src 'none'"><script>template()</script></template><textarea><script>text()</script></textarea>`;
  const source = `<html><head>${meta}</head><body>${inert}<script nonce="test-nonce">const value='<img src="http://localhost:8000/a">';</script></body></html>`;
  const result = adaptShareHtml(Buffer.from(source), config, "script-src 'nonce-test-nonce'; connect-src 'self'").toString();
  assert.ok(result.includes(inert));
  assert.ok(result.includes(`const value='<img src="http://localhost:8000/a">';`));
  assert.ok(result.indexOf(SHARE_ADAPTER_PATH) > result.indexOf('</textarea>'));
  assert.ok(result.includes(`src="${SHARE_ADAPTER_PATH}" nonce="test-nonce"`));
});

test('backend routing preserves cookie scope, redirects and CSRF origin checks and refuses private paths', async (t) => {
  const received = [];
  let api;
  api = await listen(t, createServer((req, res) => {
    received.push({ path: req.url, origin: req.headers.origin, referer: req.headers.referer });
    if (req.url === '/auth/login') {
      res.writeHead(302, { Location: 'continue?done=1', 'Set-Cookie': ['session=auth; Domain=localhost; Path=/auth; HttpOnly', '__Host-session=root; Path=/; Secure; HttpOnly'] });
    } else if (req.url === '/api/login') {
      res.writeHead(302, { Location: api.replace('127.0.0.1', 'localhost') + 'api/me', 'Set-Cookie': 'session=api; Path=/api; HttpOnly' });
    } else res.setHeader('Content-Type', 'application/json');
    res.end('{}');
  }));
  const frontend = await listen(t, createServer((req, res) => res.end('frontend')));
  const preview = await listen(t, await createLocalPreview({ url: frontend, apiUrl: api, shareId: 'adapter-routing' }));
  const auth = await fetch(preview + SHARE_API_PATH.slice(1) + '/auth/login', { redirect: 'manual' });
  const cookies = auth.headers.getSetCookie();
  assert.ok(cookies.some((cookie) => cookie.includes(`Path=${SHARE_API_PATH}/auth`) && !cookie.includes('Domain=')));
  assert.ok(cookies.includes('__Host-session=root; Path=/; Secure; HttpOnly'));
  const login = await fetch(preview + 'api/login', { redirect: 'manual' });
  assert.equal(login.headers.get('location'), '/api/me'); assert.ok(login.headers.get('set-cookie').includes('Path=/api;'));
  await fetch(preview + 'api/notes', { method: 'POST', headers: { Origin: new URL(preview).origin, Referer: preview + 'notes' } });
  assert.equal(received.at(-1).origin, new URL(api).origin); assert.equal(received.at(-1).referer, api + 'notes');
  await fetch(preview + 'api/notes', { method: 'POST', headers: { Origin: 'https://outside.example', Referer: 'https://outside.example/form' } });
  assert.equal(received.at(-1).origin, 'https://outside.example'); assert.equal(received.at(-1).referer, 'https://outside.example/form');
  const count = received.length;
  for (const path of ['/.env', '/%252eenv', '/@fs/private', '//127.0.0.1:9999/admin']) assert.equal((await getRaw(preview, SHARE_API_PATH + path)).status, 404);
  assert.equal(received.length, count);
  assert.equal(auth.headers.get('location'), SHARE_API_PATH + '/auth/continue?done=1');
});

test('compressed upstream HTML is adapted with correct response metadata while scripts and JSON pass through', async (t) => {
  const html = '<!doctype html><html><head><script src="/app.js"></script></head><body>page</body></html>';
  const app = await listen(t, createServer((req, res) => {
    if (req.url === '/') {
      const bytes = gzipSync(html);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip', 'Content-Length': bytes.length, ETag: '"source-html"', 'Content-Security-Policy': "script-src 'self'; connect-src 'self'" });
      res.end(bytes);
    } else {
      res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'application/json');
      res.end('"http://localhost:9999/keep-original"');
    }
  }));
  const preview = await listen(t, await createLocalPreview({ url: app, shareId: 'adapter-compressed' }));
  const response = await fetch(preview); const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.toString().includes(SHARE_ADAPTER_PATH));
  assert.equal(Number(response.headers.get('content-length')), bytes.length);
  assert.equal(response.headers.get('content-encoding'), null); assert.equal(response.headers.get('etag'), null);
  assert.equal(response.headers.get('content-security-policy'), "script-src 'self'; connect-src 'self'");
  for (const path of ['app.js', 'data.json']) assert.equal(await (await fetch(preview + path)).text(), '"http://localhost:9999/keep-original"');
});
