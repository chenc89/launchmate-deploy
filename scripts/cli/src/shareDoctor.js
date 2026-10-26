import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LaunchmateError } from './errors.js';

/** 仅读取工具版本，不安装软件、启动通道或加载账户配置。 */
export async function shareDoctor({ cloudflared = 'cloudflared' } = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeReady = major > 18 || (major === 18 && minor >= 17);
  let client;
  try {
    const result = await promisify(execFile)(cloudflared, ['--version'], { env: { PATH: process.env.PATH, ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) }, timeout: 5000, maxBuffer: 4096 });
    const version = (result.stdout + result.stderr).trim();
    if (!/^cloudflared version /i.test(version)) throw new LaunchmateError('指定程序没有返回 cloudflared 版本。');
    client = { ready: true, version };
  } catch { client = { ready: false, message: '未找到可用的官方 cloudflared；请安装，或用 --cloudflared 指定可信路径。', install_url: 'https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/' }; }
  return { ready: nodeReady && client.ready, node: { ready: nodeReady, version: process.version }, cloudflared: client, system: process.platform, arch: process.arch };
}
