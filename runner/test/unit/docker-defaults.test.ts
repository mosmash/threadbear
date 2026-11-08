import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../src/config.ts';
import { makeHarness, tmpDir } from '../helpers/fakes.ts';

test('container bind requires explicit opt-in; unsupported values stay loopback', () => {
  const home = tmpDir();
  assert.equal(loadConfig({ THREADBEAR_HOME: home }).host, '127.0.0.1');
  assert.equal(loadConfig({ THREADBEAR_HOME: home, THREADBEAR_BIND: '0.0.0.0' }).host, '0.0.0.0');
  assert.equal(loadConfig({ THREADBEAR_HOME: home, THREADBEAR_BIND: 'arbitrary' }).host, '127.0.0.1');
});
test('configured permission mode applies without overriding an explicit choice', async () => {
  const h = makeHarness(undefined, { defaults: { cwd: tmpDir(), permissionMode: 'ask' } });
  assert.equal(h.runner.create({ text: 'test', accountId: 'claude-3' }).thread.permissionMode, 'ask');
  assert.equal(h.adapter.last.opts.permissionMode, 'ask');
  assert.equal(h.runner.create({ text: 'test', accountId: 'claude-3', permissionMode: 'plan' }).thread.permissionMode, 'plan');
  await h.runner.shutdown();
});
test('invalid configured permissions cannot raise access', () => {
  const home = tmpDir();
  fs.writeFileSync(path.join(home, 'runner.json'), JSON.stringify({ defaults: { permissionMode: 'invalid' } }));
  assert.equal(loadConfig({ THREADBEAR_HOME: home }).defaults.permissionMode, undefined);
});
