export const SHARE_API_PATH = '/__launchmate_share/api';
export const SHARE_ADAPTER_PATH = '/__launchmate_share/adapter.js';

export function shareUrlConfig(frontend, backend, apiPrefix = '/api') {
  return { frontend_port: frontend?.port || null, backend_port: backend?.port || null, api_prefix: apiPrefix, backend_path: SHARE_API_PATH };
}

// 该函数同时在代理和浏览器运行；地址只匹配启动时选定的端口。
export function mapShareUrl(value, config, base = 'https://preview.invalid/') {
  const page = new URL(base);
  const reservedPage = page.pathname === config.backend_path || page.pathname.startsWith(config.backend_path + '/');
  const apiPage = page.pathname === config.api_prefix || page.pathname.startsWith(config.api_prefix + '/');
  let documentUrl = config.document_url;
  if (!documentUrl && config.backend_port && (reservedPage || apiPage)) {
    const path = reservedPage ? page.pathname.slice(config.backend_path.length) || '/' : page.pathname;
    documentUrl = `http://127.0.0.1:${config.backend_port}${path}${page.search}`;
  }
  // 普通相对地址用占位主机解析，避免本机预览时误认成回环请求。
  let address;
  try { address = new URL(String(value), documentUrl || `${page.protocol}//preview.invalid/`); }
  catch { return String(value); }
  if (documentUrl && address.origin === page.origin) address = new URL(address.pathname + address.search + address.hash, documentUrl);
  if (!['http:', 'https:'].includes(address.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(address.hostname)) return String(value);
  if (address.username || address.password) throw new Error('分享不支持带凭据的本机 URL。');
  const port = address.port || (address.protocol === 'https:' ? '443' : '80');
  const path = address.pathname + address.search + address.hash;
  if (address.pathname.startsWith('//')) throw new Error('分享不支持双斜线开头的本机路径。');
  if (port === config.frontend_port) return path;
  if (port === config.backend_port) {
    const isPublicPath = address.pathname === config.api_prefix || address.pathname.startsWith(config.api_prefix + '/')
      || address.pathname === config.backend_path || address.pathname.startsWith(config.backend_path + '/');
    return isPublicPath ? path : config.backend_path + path;
  }
  throw new Error(`本机端口 ${port} 未包含在此次分享中。请核对项目的后端服务。`);
}

export function backendSharePath(path, config) {
  if (path === config.api_prefix || path.startsWith(config.api_prefix + '/')) return path;
  return config.backend_path + path;
}
