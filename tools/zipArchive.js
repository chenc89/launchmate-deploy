import fs from 'node:fs/promises';
import path from 'node:path';
import { validateArchivePath } from '../scripts/cli/src/paths.js';
import { LaunchmateError } from '../scripts/cli/src/errors.js';

const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Store 模式 ZIP：不需要外部 zip 程序，也不执行源码。 */
export function createZipArchive(files) {
  if (files.length === 0 || files.length > 5000) throw new LaunchmateError('ZIP 必须包含 1–5000 个文件。');
  const names = new Set();
  const localEntries = [];
  const centralEntries = [];
  let offset = 0;
  for (const file of files) {
    validateArchivePath(file.path);
    if (names.has(file.path)) throw new LaunchmateError('ZIP 文件路径重复。', { code: 'UNSAFE_PATH' });
    names.add(file.path);
    const name = Buffer.from(file.path, 'utf8');
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    if (name.length > 65535 || content.length > 100 * 1024 * 1024 || offset > 100 * 1024 * 1024) throw new LaunchmateError('ZIP 超过 100 MiB 限制。');
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    localEntries.push(local, name, content);
    centralEntries.push(central, name);
    offset += local.length + name.length + content.length;
  }
  const centralDirectory = Buffer.concat(centralEntries);
  const ending = Buffer.alloc(22);
  ending.writeUInt32LE(0x06054b50, 0);
  ending.writeUInt16LE(files.length, 8);
  ending.writeUInt16LE(files.length, 10);
  ending.writeUInt32LE(centralDirectory.length, 12);
  ending.writeUInt32LE(offset, 16);
  return Buffer.concat([...localEntries, centralDirectory, ending]);
}

export async function saveZipArchive(files, outputPath, maxBytes = 100 * 1024 * 1024) {
  if (!outputPath) throw new LaunchmateError('请指定 ZIP 输出路径 --out。');
  const resolved = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  // 不覆盖已有文件或符号链接，避免写到用户没有选择的位置。
  const archive = createZipArchive(files);
  if (archive.length > maxBytes) throw new LaunchmateError('ZIP 归档超过允许的大小。');
  await fs.writeFile(resolved, archive, { flag: 'wx', mode: 0o600 });
  return resolved;
}
