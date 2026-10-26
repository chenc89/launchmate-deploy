import { fork } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LaunchmateError } from './errors.js';

/** 官方客户端只接收必要的运行环境，保留已有 Cloudflare 配置。 */
export async function createQuickTunnel({ origin, hostHeader, binary = 'cloudflared' }) {
  if (binary.includes('/') || binary.includes('\\')) { binary = resolve(binary); await access(binary, constants.X_OK); }
  const args = ['--no-autoupdate', '--protocol', 'http2', '--edge-ip-version', '4', '--metrics', '127.0.0.1:0', '--url', origin];
  if (hostHeader) args.push('--http-host-header', hostHeader);
  const child = fork(fileURLToPath(new URL('./tunnelSupervisor.js', import.meta.url)), [JSON.stringify({ binary, args })], { env: { PATH: process.env.PATH, ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) }, execArgv: [], silent: true });
  await new Promise((resolveSpawn, reject) => {
    child.once('message', (message) => {
      if (message.type === 'started') resolveSpawn();
      else reject(new LaunchmateError(message.code === 'ENOENT' ? '未找到 cloudflared；请安装官方客户端或用 --cloudflared 指定路径。' : 'cloudflared 无法启动。', { code: message.code === 'ENOENT' ? 'CLOUDFLARED_REQUIRED' : 'SHARE_TUNNEL_START_FAILED' }));
    });
    child.once('error', reject);
    child.once('exit', () => reject(new LaunchmateError('通道监督进程已退出。', { code: 'SHARE_TUNNEL_START_FAILED' })));
  });
  return child;
}
