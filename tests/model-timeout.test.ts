import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { jsonCompletion } from '../worker/llm';
import type { Env } from '../worker/env';

const env = { KIMI_API_KEY: 'test' } as Env;
const schema = z.object({ ok: z.boolean() });
const response = (content: string) => Response.json({ choices: [{ message: { content } }] });

test('slow model responses can finish after the old 110-second cutoff', async (t) => {
  let now = 0;
  const waits: number[] = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    waits.push(ms);
    return new AbortController().signal;
  });
  t.mock.method(globalThis, 'fetch', async () => {
    now = 200_000;
    return response('{"ok":true}');
  });
  assert.deepEqual(await jsonCompletion(env, '', {}, schema), { ok: true });
  assert.deepEqual(waits, [300_000]);
});

test('schema correction shares the remaining model deadline', async (t) => {
  let now = 0;
  const waits: number[] = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    waits.push(ms);
    return new AbortController().signal;
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    now = 290_000;
    return response(calls === 1 ? '{}' : '{"ok":true}');
  });
  assert.deepEqual(await jsonCompletion(env, '', {}, schema, 5000, 310_000), { ok: true });
  assert.deepEqual(waits, [300_000, 20_000]);
});

test('timeout while reading the response body is explained and never retried', async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => controller.signal);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return {
      ok: true,
      async json() {
        controller.abort(new DOMException('timed out', 'TimeoutError'));
        throw controller.signal.reason;
      },
    };
  });
  await assert.rejects(jsonCompletion(env, '', {}, schema), /Kimi 等待超过 300 秒/);
  assert.equal(calls, 1);
});

test('an exhausted shared budget never starts another provider request', async (t) => {
  t.mock.method(Date, 'now', () => 600_001);
  const fetch = t.mock.method(globalThis, 'fetch', async () => response('{"ok":true}'));
  await assert.rejects(jsonCompletion(env, '', {}, schema, 5000, 600_000), /10 分钟上限/);
  assert.equal(fetch.mock.callCount(), 0);
});
