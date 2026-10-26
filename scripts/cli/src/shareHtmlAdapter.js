import { SHARE_ADAPTER_PATH, mapShareUrl } from './shareUrlAdapter.js';
import { LaunchmateError } from './errors.js';

export const MAX_ADAPTED_HTML = 8 * 1024 * 1024;
const ATTRIBUTE = /(\s+)([^\s"'<>/=]+)(?:([\t\n\f\r ]*=[\t\n\f\r ]*)(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const URL_ATTRIBUTES = new Set(['src', 'href', 'action', 'formaction', 'poster']);

function decodeAttribute(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[entity.toLowerCase()];
    if (named) return named;
    const number = entity.slice(2, -1);
    const point = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const name = match[2].toLowerCase();
    if (!Object.hasOwn(result, name)) result[name] = decodeAttribute(match[4] ?? match[5] ?? match[6] ?? '');
  }
  return result;
}

function htmlTags(html) {
  const pattern = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[a-z][a-z0-9:-]*(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const result = []; let depth = 0; let match;
  while ((match = pattern.exec(html))) {
    if (match[0].startsWith('<!')) continue;
    const name = /^<\/?([\w:-]+)/.exec(match[0])[1].toLowerCase();
    const closing = match[0].startsWith('</');
    const tag = { text: match[0], index: match.index, end: pattern.lastIndex, name, closing, inert: depth > 0 };
    result.push(tag);
    if (name === 'template') depth = Math.max(0, depth + (closing ? -1 : 1));
    if (!closing && ['script', 'style', 'textarea', 'title', 'noscript', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'].includes(name)) {
      const end = new RegExp(`</${name}\\s*>`, 'ig'); end.lastIndex = pattern.lastIndex;
      pattern.lastIndex = name !== 'plaintext' && end.exec(html) ? end.lastIndex : html.length;
    }
  }
  return result;
}

export function adaptShareHtml(bytes, config, policyHeader) {
  if (bytes.length > MAX_ADAPTED_HTML) throw new LaunchmateError('页面超过 8 MiB，无法进行本次浏览器地址适配。', { code: 'SHARE_HTML_TOO_LARGE' });
  const html = bytes.toString('utf8');
  const tags = htmlTags(html);
  const baseTag = tags.find((tag) => tag.name === 'base' && !tag.inert && !tag.closing && Object.hasOwn(attributes(tag.text), 'href'));
  let documentAdapter = config;
  if (config.document_url && baseTag) {
    try { documentAdapter = { ...config, document_url: new URL(attributes(baseTag.text).href, config.document_url).href }; }
    catch { /* 无效 base 沿用原文档地址。 */ }
  }
  const firstScript = tags.find((tag) => tag.name === 'script' && !tag.inert && !tag.closing);
  const nonce = tags.filter((tag) => tag.name === 'script' && !tag.inert && !tag.closing).map((tag) => attributes(tag.text).nonce).find((value) => value && /^[A-Za-z0-9+/_=-]+$/.test(value));
  const policies = policyHeader ? (Array.isArray(policyHeader) ? policyHeader : [policyHeader]).flatMap((value) => value.split(',')) : [];
  let lastPolicyEnd = 0;
  for (const tag of tags.filter((item) => item.name === 'meta' && !item.inert)) {
    const meta = attributes(tag.text);
    if (meta['http-equiv']?.toLowerCase() !== 'content-security-policy') continue;
    policies.push(meta.content || "script-src 'none'");
    lastPolicyEnd = tag.end;
  }
  for (const policy of policies) {
    const directives = new Map();
    for (const part of policy.split(';')) {
      const [name, ...sources] = part.trim().split(/\s+/);
      if (!directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
    }
    const sources = directives.get('script-src-elem') || directives.get('script-src') || directives.get('default-src');
    const allowedNonce = nonce && sources?.includes(`'nonce-${nonce}'`);
    if (sources && !allowedNonce && (sources.includes("'strict-dynamic'") || (!sources.includes("'self'") && !sources.includes('*')))) {
      throw new LaunchmateError('页面 CSP 不允许同源分享适配脚本；已保留原策略，无法自动处理其 localhost 请求。', { code: 'SHARE_ADAPTER_CSP' });
    }
    const connections = directives.get('connect-src') || directives.get('default-src');
    if (connections && !connections.includes("'self'") && !connections.includes('*') && !connections.includes('https:')) {
      throw new LaunchmateError('页面 CSP 未允许同源接口请求，无法自动适配；已保留原策略。', { code: 'SHARE_ADAPTER_CSP' });
    }
  }
  if (firstScript && lastPolicyEnd > firstScript.index) throw new LaunchmateError('页面在脚本之后声明 CSP，无法安全插入分享适配脚本。', { code: 'SHARE_ADAPTER_CSP' });

  // 只处理 HTML 标签的 URL 属性，脚本、样式和业务文本不做字符串替换。
  const edits = [];
  for (const tag of tags.filter((item) => !item.closing)) {
    const mapped = tag.text.replace(ATTRIBUTE, (whole, space, name, equals, double, single, unquoted) => {
      if (!equals || !URL_ATTRIBUTES.has(name.toLowerCase())) return whole;
      const value = decodeAttribute(double ?? single ?? unquoted);
      let url;
      try { url = mapShareUrl(value, tag === baseTag ? config : documentAdapter); }
      catch (error) { throw new LaunchmateError(error.message, { code: 'SHARE_UNMAPPED_ORIGIN' }); }
      if (url === value) return whole;
      return space + name + equals + '"' + url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') + '"';
    });
    if (mapped !== tag.text) edits.push({ start: tag.index, end: tag.end, text: mapped });
  }
  const script = `<script src="${SHARE_ADAPTER_PATH}"${nonce ? ` nonce="${nonce}"` : ''}></script>`;
  const position = Math.max(lastPolicyEnd, firstScript?.index ?? tags.find((tag) => tag.name === 'head' && tag.closing && !tag.inert)?.index ?? html.length);
  edits.push({ start: position, end: position, text: script });
  let adapted = html;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) adapted = adapted.slice(0, edit.start) + edit.text + adapted.slice(edit.end);
  return Buffer.from(adapted);
}
