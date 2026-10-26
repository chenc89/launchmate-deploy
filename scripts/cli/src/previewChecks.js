import { LaunchmateError } from './errors.js';
import { publicPreviewPath } from './previewProxy.js';

export function checkPreviewPath(path) {
  if (typeof path !== 'string' || !publicPreviewPath(path) || path.includes('?') || path.includes('#') || path.startsWith('//')) throw new LaunchmateError('健康检查必须是应用内的安全路径，例如 /health 或 /api/health。');
  return path;
}

export async function checkPreview(origin, path, headers = {}, fetchImpl = globalThis.fetch, signal = AbortSignal.timeout(5000)) {
  const response = await fetchImpl(new URL(path, origin).href, { redirect: 'manual', headers, signal });
  await response.body?.cancel();
  return { path, http_status: response.status, content_type: response.headers.get('content-type'), preview_id: response.headers.get('x-launchmate-preview') };
}

export function assertPreviewReady(result) {
  if (result.http_status < 200 || result.http_status >= 400) throw new LaunchmateError(`检查 ${result.path} 返回 HTTP ${result.http_status}；请确认服务已运行，或用 --check-path / --api-check-path 指定可访问的健康接口。`, { code: 'PREVIEW_NOT_READY' });
}
