import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createModelRelay } from './model-relay.mjs';
import { codexModels } from './model-policy.mjs';

test('the pinned native picker catalog exactly matches the relay Codex grants', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('./codex/models.json', import.meta.url)));
  assert.deepEqual(catalog.models.map(row => row.slug).sort(), [...codexModels].sort());
});

async function fixture(t, fetchImpl, initialRequests = 0) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-relay-test-'));
  if (initialRequests) fs.writeFileSync(path.join(stateDir, 'usage.json'), JSON.stringify({ day: new Date().toISOString().slice(0,10), requests: initialRequests }));
  const server = createModelRelay({ token: 'trial-only-test-key', upstreamKey: 'upstream-only-test-key' }, { stateDir, fetchImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(stateDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    stateDir,
    request: (route, data, headers = {}) => fetch(base + route, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer trial-only-test-key', 'content-type': 'application/json', ...headers },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }),
  };
}

test('authentication and route/model families fail closed before forwarding', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return new Response('{}'); });
  assert.equal((await f.request('/health', undefined, { authorization: '' })).status, 200);
  assert.equal((await f.request('/v1/models', undefined, { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await f.request('/management/models')).status, 403);
  assert.equal((await f.request('/v1/chat/completions', { model: 'gpt-6.1-sol' })).status, 403);
  assert.equal((await f.request('/v1/responses', { model: 'claude-opus-5-5' })).status, 403);
  assert.equal((await f.request('/v1/messages', { model: 'gpt-6.1-sol', max_tokens: 1 })).status, 403);
  assert.equal((await f.request('/v1/responses', { model: 'gpt-image-2' })).status, 403);
  assert.equal(calls, 0);
});

test('Codex streaming preserves events and tools, caps output and uses only the upstream credential', async t => {
  const forwarded = [];
  const stream = 'event: response.completed\ndata: {"type":"response.completed"}\n\n';
  const f = await fixture(t, async (url, options) => {
    forwarded.push({ url, ...options, body: JSON.parse(options.body) });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  });
  const tools = [{ type: 'function', name: 'test_tool', parameters: { type: 'object' } }];
  for (const limit of [undefined, 30000, 23]) {
    const r = await f.request('/v1/responses', { model: 'gpt-6.1-sol', input: 'Synthetic test', tools, stream: true, ...(limit === undefined ? {} : { max_output_tokens: limit }) });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/event-stream/);
    assert.equal(await r.text(), stream);
  }
  assert.deepEqual(forwarded.map(r => r.body.max_output_tokens), [16384, 16384, 23]);
  for (const r of forwarded) {
    assert.equal(r.url, 'http://cliproxyapi:8317/v1/responses');
    assert.equal(r.redirect, 'error');
    assert.equal(r.headers.authorization, 'Bearer upstream-only-test-key');
    assert.equal(r.headers['anthropic-version'], undefined);
    assert.deepEqual(r.body.tools, tools);
    assert.equal(r.body.store, false);
  }
  assert.equal((await f.request('/v1/responses', { model: 'gpt-6.1-sol', max_output_tokens: -1 })).status, 400);
});

test('model catalogs omit ungranted models and select the correct provider family', async t => {
  const headers = [];
  const f = await fixture(t, async (_url, options) => {
    headers.push(options.headers);
    return Response.json({ data: ['gpt-6.1-sol', 'claude-haiku-5-5', 'gpt-image-2', 'unknown'].map(id => ({ id })) });
  });
  const r = await f.request('/v1/models');
  assert.deepEqual((await r.json()).data.map(row => row.id), ['gpt-6.1-sol', 'claude-haiku-5-5']);
  assert.equal(headers[0]['anthropic-version'], undefined);
  await f.request('/v1/models', undefined, { 'anthropic-version': '2023-06-01' });
  assert.equal(headers[1]['anthropic-version'], '2023-06-01');
  assert.equal(fs.existsSync(path.join(f.stateDir, 'usage.json')), false);
});

test('Claude keeps count-token support and its output/SDK headers', async t => {
  const forwarded = [];
  const f = await fixture(t, async (url, options) => { forwarded.push({ url, ...options }); return Response.json({ ok: true }); });
  assert.equal((await f.request('/v1/messages/count_tokens', { model: 'claude-haiku-5-5', messages: [] })).status, 200);
  assert.equal((await f.request('/v1/messages', { model: 'claude-haiku-5-5', max_tokens: 16384 }, { 'anthropic-beta': 'test-beta' })).status, 200);
  assert.equal((await f.request('/v1/messages', { model: 'claude-haiku-5-5', max_tokens: 16385 })).status, 400);
  assert.equal(forwarded[0].headers['anthropic-version'], '2023-06-01');
  assert.equal(forwarded[1].headers['anthropic-beta'], 'test-beta');
});

test('both providers share the durable daily quota', async t => {
  const f = await fixture(t, async () => Response.json({ ok: true }), 199);
  assert.equal((await f.request('/v1/responses', { model: 'gpt-6.1-sol' })).status, 200);
  assert.equal((await f.request('/v1/messages', { model: 'claude-haiku-5-5', max_tokens: 1 })).status, 429);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.stateDir, 'usage.json'))).requests, 200);
});

test('both providers share two concurrency slots', async t => {
  let count = 0, ready, release;
  const started = new Promise(resolve => { ready = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, async () => { if (++count === 2) ready(); await gate; return Response.json({ ok: true }); });
  const one = f.request('/v1/responses', { model: 'gpt-6.1-sol' });
  const two = f.request('/v1/messages', { model: 'claude-haiku-5-5', max_tokens: 1 });
  await started;
  assert.equal((await f.request('/v1/responses', { model: 'gpt-6-sol' })).status, 429);
  release();
  assert.equal((await one).status, 200); assert.equal((await two).status, 200);
});
