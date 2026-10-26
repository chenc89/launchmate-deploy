import { LaunchmateError, safeError } from './errors.js';
import { printJson } from './output.js';
import { shareApplication } from './shareApplication.js';
import { listShares, stopShare } from './shareSessions.js';
import { shareDoctor } from './shareDoctor.js';

const HELP = `Launchmate Share — 本地应用分享（Node.js 18.17+）

  launchmate share --dir ./my-page [--cloudflared /path/to/cloudflared]
  launchmate share --url http://127.0.0.1:5173/ [--protected]
  launchmate share --url http://127.0.0.1:5173/ --api-url http://127.0.0.1:8000/ [--api-prefix /api] [--api-check-path /api/health] [--protected]
  launchmate share --url http://127.0.0.1:8000/ --check-path /health
  launchmate share-status [--id 分享ID]
  launchmate share-stop --id 分享ID
  launchmate share-doctor [--cloudflared /path/to/cloudflared]

支持静态目录、已运行的 HTTP 应用、纯 API 和前后端分端口组合。
分享时适配已选端口的 localhost 请求，保留原项目文件和数据库。
--protected 开启预览密码；可用 LAUNCHMATE_SHARE_PASSWORD 配置，或生成到私有密码文件。
重复分享会重新检查本机和公网入口，通过后复用原链接。
保持电脑、应用和本次会话运行；share-stop 或 Ctrl+C 只关闭本次分享。
需要官方 cloudflared；运行 share-doctor 检查依赖。
`;

const OPTIONS = {
  share: ['dir', 'url', 'cloudflared', 'api-url', 'api-prefix', 'check-path', 'api-check-path', 'protected'],
  'share-status': ['id'],
  'share-stop': ['id'],
  'share-doctor': ['cloudflared'],
};

export function parseArguments(args) {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h') return { command: 'help', options: {} };
  if (!Object.hasOwn(OPTIONS, command)) throw new LaunchmateError('未知命令。运行 launchmate --help 查看分享用法。');
  const options = {};
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    if (argument === '--help' || argument === '-h') return { command: 'help', options: {} };
    if (!argument.startsWith('--')) throw new LaunchmateError('参数必须使用 --选项 值 格式。');
    const key = argument.slice(2);
    if (!OPTIONS[command].includes(key) || Object.hasOwn(options, key)) throw new LaunchmateError('存在不支持或重复的选项，请运行 launchmate --help。');
    if (key === 'protected') { options[key] = true; continue; }
    const value = rest[++index];
    if (!value || value.startsWith('--')) throw new LaunchmateError('选项缺少参数值。');
    options[key] = value;
  }
  return { command, options };
}

export async function runCli(args = process.argv.slice(2)) {
  try {
    const { command, options } = parseArguments(args);
    if (command === 'help') { process.stdout.write(HELP); return; }
    if (command === 'share') {
      await shareApplication({ directory: options.dir, url: options.url, apiUrl: options['api-url'], apiPrefix: options['api-prefix'], checkPath: options['check-path'], apiCheckPath: options['api-check-path'], protected: options.protected === true, cloudflared: options.cloudflared, confirmShare: true, onReady: printJson, onProgress: (message) => process.stderr.write(message + '\n') });
      return;
    }
    if (command === 'share-status') printJson(await listShares(options.id));
    else if (command === 'share-stop') printJson(await stopShare(options.id));
    else printJson(await shareDoctor({ cloudflared: options.cloudflared }));
  } catch (error) { printJson({ error: safeError(error) }, process.stderr); process.exitCode = 1; }
}
