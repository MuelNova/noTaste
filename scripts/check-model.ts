import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { z } from 'zod';
import { jsonCompletion } from '../worker/llm';
import type { Env } from '../worker/env';
try {
  const env = parseEnv(readFileSync('.dev.vars', 'utf8')) as unknown as Env;
  const result = await jsonCompletion(
    env,
    '只返回 JSON 对象 {"ok":true}。这是连接测试。',
    {},
    z.object({ ok: z.boolean() }),
    1024,
  );
  console.log('结构化生成测试：' + (result.ok ? '通过' : '未通过'));
} catch (e) {
  console.log((e as Error).message);
  process.exitCode = 1;
}
