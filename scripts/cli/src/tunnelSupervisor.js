import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { binary, args } = JSON.parse(process.argv[2]);
const root = await mkdtemp(join(tmpdir(), 'launchmate-tunnel-'));
const config = join(root, 'config.yml');
await writeFile(config, '{}\n', { mode: 0o600 });
let child; let timer; let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  child?.kill('SIGTERM');
  timer = setTimeout(() => child?.kill('SIGKILL'), 2000); timer.unref();
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, stop);
// 父进程即使被强制结束，IPC 断开也会撤销本次公网通道。
process.once('disconnect', stop);
child = spawn(binary, ['tunnel', '--config', config, ...args], { env: { PATH: process.env.PATH, HOME: root, USERPROFILE: root, ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}) }, stdio: ['ignore', 'inherit', 'inherit'] });
child.once('spawn', () => { if (stopping) child.kill('SIGTERM'); else process.send?.({ type: 'started' }); });
child.once('error', async (error) => { process.send?.({ type: 'startup_error', code: error.code, message: error.message }); await rm(root, { recursive: true, force: true }); process.exit(1); });
child.once('exit', async (code, signal) => { clearTimeout(timer); await rm(root, { recursive: true, force: true }); process.exit(stopping ? 0 : (code || (signal ? 1 : 0))); });
