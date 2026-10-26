import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArguments } from '../src/shareCli.js';

test('standalone CLI exposes only sharing commands with strict options', () => {
  assert.deepEqual(parseArguments(['share', '--url', 'http://127.0.0.1:5173/', '--protected']), { command: 'share', options: { url: 'http://127.0.0.1:5173/', protected: true } });
  for (const command of ['deploy', 'inspect', 'sync', 'publish', 'mcp', 'backend-config', 'constructor', 'toString']) assert.throws(() => parseArguments([command]), /未知命令/);
  assert.throws(() => parseArguments(['share', '--url', 'http://127.0.0.1:1/', '--url', 'http://127.0.0.1:2/']), /重复/);
  assert.throws(() => parseArguments(['share', '--url']), /缺少/);
  assert.throws(() => parseArguments(['share', '--server', 'https://example.com']), /不支持/);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/launchmate.js', import.meta.url)), '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Launchmate Share/);
  assert.doesNotMatch(result.stdout, /launchmate (?:deploy|mcp|backend-|sync|publish|build|inspect)/);
});
