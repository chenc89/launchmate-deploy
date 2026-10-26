import path from 'node:path';
import fs from 'node:fs/promises';
import { LaunchmateError } from './errors.js';

export function validateArchivePath(filePath) {
  if (typeof filePath !== 'string' || !filePath || Buffer.byteLength(filePath) > 240 || filePath.includes('\0') || filePath.includes('\\') || filePath.startsWith('/') || /^[a-z]:/i.test(filePath)) {
    throw new LaunchmateError('归档路径必须是安全的相对路径。', { code: 'UNSAFE_PATH' });
  }
  if (filePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new LaunchmateError('归档路径不可包含空段、. 或 ..。', { code: 'UNSAFE_PATH' });
  }
  return filePath;
}

export async function resolveProjectDirectory(directory) {
  if (!directory) throw new LaunchmateError('请指定项目目录 --dir。');
  const resolved = path.resolve(directory);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new LaunchmateError('项目目录必须是实际文件夹，不能是符号链接。');
  const real = await fs.realpath(resolved);
  if (real !== resolved) throw new LaunchmateError('项目目录路径包含符号链接，请使用真实路径。');
  return real;
}

export function isPrivatePath(filePath) {
  return filePath.split('/').some((part) => /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.npmrc|\.netrc|\.pypirc|\.DS_Store|id_rsa|id_ed25519|credentials(?:\..*)?)$/i.test(part)) || /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(filePath);
}

export function isInsideDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}
