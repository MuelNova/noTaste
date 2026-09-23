import type { Env } from './env';
import { appUrl, isLocal } from './env';
import { cookie, cookies, decrypt, encrypt, equal, sameOrigin, verifiedSession } from './security';
import { connect } from './spotify';
import { daily, processReportTask } from './pipeline';
import { enqueueReport, generationState, allowedPeriod, type ReportTask } from './jobs';
import { accessConfigured, verifyAccessToken } from './access';
import { periodBounds } from '../shared/metrics';
import { demoReport } from '../shared/demo';
import { checkModel } from './llm';
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
const redirect = (url: string, headers: Record<string, string> = {}) =>
  new Response(null, {
    status: 302,
    headers: { Location: url, ...headers, 'Cache-Control': 'no-store' },
  });
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const u = new URL(request.url),
      path = u.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const session = await verifiedSession(request, env),
        verified = !!session,
        owner = verified || (isLocal(request, env) && !env.ADMIN_PASSWORD);
      if (request.method === 'POST' && !sameOrigin(request, env))
        return json({ error: '请求来源不匹配' }, 403);
      if (path === '/api/status') {
        const connected = !!(await env.DB.prepare('SELECT id FROM auth WHERE id=?')
          .bind('spotify')
          .first());
        return json({
          owner,
          verified_owner: verified,
          auth_method: session?.method ?? null,
          access_configured: accessConfigured(env),
          password_configured: !!env.ADMIN_PASSWORD,
          generation_ready: !!(
            connected &&
            env.KIMI_API_KEY &&
            (owner || env.PUBLIC_REPORTS === 'true')
          ),
          telegram_configured: owner
            ? !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)
            : undefined,
          connected: owner ? connected : undefined,
          spotify_configured: owner
            ? !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET)
            : undefined,
          kimi_configured: owner ? !!env.KIMI_API_KEY : undefined,
          public_reports: env.PUBLIC_REPORTS === 'true',
          timezone: env.TIMEZONE || 'Australia/Perth',
          local: isLocal(request, env),
        });
      }
      if (path === '/api/admin/model-check' && request.method === 'POST') {
        if (!verified) return json({ error: '请先登录管理员账号' }, 401);
        return json(await checkModel(env));
      }
      if (path === '/api/admin/login' && request.method === 'GET') {
        if (!accessConfigured(env))
          return json({ error: '请先配置 Cloudflare Access 邮箱登录' }, 503);
        const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
        if (!assertion) return json({ error: '请从配置了 Cloudflare Access 的正式域名登录' }, 401);
        try {
          const identity = await verifyAccessToken(assertion, env);
          const value = await encrypt({ ...identity, role: 'owner', method: 'cloudflare' }, env);
          return redirect(appUrl(env) + '/?settings=1', {
            'Set-Cookie': cookie(
              'taste_session',
              value,
              request,
              Math.max(0, Math.floor((identity.expires - Date.now()) / 1000)),
            ),
          });
        } catch {
          return json({ error: '主人身份验证失败，请用已配置的邮箱重新登录' }, 403);
        }
      }
      if (path === '/api/login' && request.method === 'POST') {
        if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 16)
          return json({ error: '站点尚未配置至少 16 位的管理口令' }, 503);
        const { password } = (await request.json()) as { password: string };
        const ip = request.headers.get('CF-Connecting-IP') ?? 'local',
          bucket = 'login:' + ip + ':' + Math.floor(Date.now() / 600000);
        const row = await env.DB.prepare('SELECT encrypted FROM auth WHERE id=?')
          .bind(bucket)
          .first<{ encrypted: string }>();
        if (Number(row?.encrypted ?? 0) >= 10)
          return json({ error: '尝试次数过多，请十分钟后重试' }, 429);
        await env.DB.prepare(
          'INSERT INTO auth VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted=CAST(auth.encrypted AS INTEGER)+1',
        )
          .bind(bucket, '1', new Date().toISOString())
          .run();
        if (typeof password !== 'string' || !(await equal(password, env.ADMIN_PASSWORD)))
          return json({ error: '管理口令不正确' }, 401);
        const session = await encrypt(
          { role: 'owner', method: 'password', expires: Date.now() + 7 * 86400000 },
          env,
        );
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': cookie('taste_session', session, request, 7 * 86400),
            'Cache-Control': 'no-store',
          },
        });
      }
      if (path === '/api/logout' && request.method === 'POST')
        return new Response('{}', {
          headers: { 'Set-Cookie': cookie('taste_session', '', request, 0) },
        });
      if (path === '/api/auth/spotify/start') {
        if (!verified)
          return accessConfigured(env)
            ? redirect(appUrl(env) + '/api/admin/login')
            : json({ error: '请先验证主人身份，再连接 Spotify' }, 401);
        if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET)
          return json({ error: '请先填写 Spotify 应用配置' }, 503);
        const state = crypto.randomUUID(),
          saved = await encrypt({ state, expires: Date.now() + 600000 }, env);
        const target = new URL('https://accounts.spotify.com/authorize');
        target.search = new URLSearchParams({
          response_type: 'code',
          client_id: env.SPOTIFY_CLIENT_ID,
          scope: 'user-read-recently-played',
          redirect_uri: appUrl(env) + '/api/auth/spotify/callback',
          state,
        }).toString();
        return redirect(target.href, {
          'Set-Cookie': cookie('spotify_state', saved, request, 600),
        });
      }
      if (path === '/api/auth/spotify/callback') {
        if (!verified) return json({ error: '主人登录已过期，请重新登录后连接 Spotify' }, 401);
        let stored;
        try {
          stored = await decrypt<{ state: string; expires: number }>(
            cookies(request).spotify_state,
            env,
          );
        } catch {
          return json({ error: '授权会话失效，请从页面重新连接' }, 400);
        }
        if (stored.expires < Date.now() || stored.state !== u.searchParams.get('state'))
          return json({ error: '授权校验失败，请重新连接' }, 400);
        if (u.searchParams.get('error'))
          return redirect(appUrl(env) + '/?auth=cancelled', {
            'Set-Cookie': cookie('spotify_state', '', request, 0),
          });
        const code = u.searchParams.get('code');
        if (!code) return json({ error: '没有收到授权码' }, 400);
        await connect(env, code);
        return redirect(appUrl(env) + '/?connected=1', {
          'Set-Cookie': cookie('spotify_state', '', request, 0),
        });
      }
      if (path === '/api/demo' && !isLocal(request, env)) return json({ error: '接口不存在' }, 404);
      if (path === '/api/demo')
        return json(
          demoReport(
            (u.searchParams.get('type') ?? 'day') as any,
            u.searchParams.get('date') ?? '2026-09-22',
          ),
        );
      if (!owner && env.PUBLIC_REPORTS !== 'true')
        return json({ error: '这是私人音乐日记，请主人登录' }, 401);
      if (path === '/api/reports') {
        const type = u.searchParams.get('type') ?? 'day';
        if (!['day', 'week', 'month'].includes(type)) return json({ error: '无效周期' }, 400);
        const date = u.searchParams.get('date');
        if (date) {
          const bounds = periodBounds(type as any, date);
          const row = await env.DB.prepare('SELECT data FROM reports WHERE type=? AND date=?')
            .bind(type, bounds.start)
            .first<{ data: string }>();
          return row ? json(JSON.parse(row.data)) : json({ error: '这一期尚未生成' }, 404);
        }
        const rows = await env.DB.prepare(
          'SELECT id,type,date,data FROM reports WHERE type=? ORDER BY date DESC LIMIT 120',
        )
          .bind(type)
          .all<{ id: string; type: string; date: string; data: string }>();
        return json(
          rows.results.map(({ data, ...r }) => ({
            ...r,
            title: JSON.parse(data).taste_comment.title,
            plays: JSON.parse(data).metrics.plays,
          })),
        );
      }
      if (path === '/api/generation') return json(await generationState(env, verified));
      if (path === '/api/generate' && request.method === 'POST') {
        const body = (await request.json()) as { type: string; date: string };
        if (!['day', 'week', 'month'].includes(body.type)) return json({ error: '无效周期' }, 400);
        let start: string;
        try {
          start = periodBounds(body.type as any, body.date).start;
        } catch {
          return json({ error: '无效日期' }, 400);
        }
        if (
          !allowedPeriod(body.type as any, body.date, verified, env.TIMEZONE || 'Australia/Perth')
        )
          return json(
            {
              error: verified
                ? '不能生成未来的报告'
                : '普通模式只能生成当天日报；历史和周／月报告需要验证主人身份',
            },
            403,
          );
        if (
          !env.KIMI_API_KEY ||
          !(await env.DB.prepare('SELECT id FROM auth WHERE id=?').bind('spotify').first())
        )
          return json({ error: '请主人先完成 Spotify 与 Kimi 配置' }, 503);
        const id = body.type + ':' + start;
        if (!(await enqueueReport(env, id, { manual: true, verified }))) {
          const state = await generationState(env, verified);
          const response = json(
            {
              ...state,
              error: state.running
                ? '已有报告正在生成，请等待完成'
                : '普通生成至少间隔 3 小时，请稍后再试',
            },
            state.running ? 409 : 429,
          );
          if (state.cooldown_seconds)
            response.headers.set('Retry-After', String(state.cooldown_seconds));
          return response;
        }
        return json({ id, status: 'queued', stage: '等待后台生成' }, 202);
      }
      if (!owner) return json({ error: '只有站点主人可以执行此操作' }, 403);
      if (path === '/api/collection') {
        const type = u.searchParams.get('type') ?? 'day';
        if (!['day', 'week', 'month'].includes(type)) return json({ error: '无效周期' }, 400);
        const { start, end } = periodBounds(type as any, u.searchParams.get('date') ?? '');
        const sample = await env.DB.prepare(
          'SELECT COUNT(*) AS plays,MIN(played_at) AS first,MAX(played_at) AS last FROM plays WHERE local_date>=? AND local_date<?',
        )
          .bind(start, end)
          .first();
        const job = await env.DB.prepare(
          'SELECT status,stage,error,updated_at FROM jobs WHERE id=?',
        )
          .bind(type + ':' + start)
          .first<{ status: string; stage: string; error: string | null; updated_at: string }>();
        if (
          job &&
          ['queued', 'running'].includes(job.status) &&
          Date.parse(job.updated_at) < Date.now() - 20 * 60000
        ) {
          job.status = 'failed';
          job.stage = '上次生成已中断，可稍后重试';
        }
        return json({ ...sample, job });
      }
      if (path === '/api/jobs')
        return json(
          await env.DB.prepare('SELECT * FROM jobs WHERE id=?')
            .bind(u.searchParams.get('id') ?? '')
            .first(),
        );
      if (path === '/api/feedback' && request.method === 'POST') {
        const { track_id, value } = (await request.json()) as { track_id: string; value: string };
        if (!['like', 'dislike', 'known'].includes(value) || typeof track_id !== 'string')
          return json({ error: '无效反馈' }, 400);
        if (!(await env.DB.prepare('SELECT id FROM tracks WHERE id=?').bind(track_id).first()))
          return json({ error: '歌曲不存在' }, 404);
        await env.DB.prepare(
          'INSERT INTO feedback VALUES (?,?,?) ON CONFLICT(track_id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
        )
          .bind(track_id, value, new Date().toISOString())
          .run();
        return json({ ok: true });
      }
      if (path === '/api/feedback' && request.method === 'GET')
        return json((await env.DB.prepare('SELECT track_id,value FROM feedback').all()).results);
      return json({ error: '接口不存在' }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : '请求失败，请稍后重试' }, 500);
    }
  },
  async queue(batch: MessageBatch<ReportTask>, env: Env) {
    for (const message of batch.messages) {
      const task = message.body;
      if (
        task &&
        typeof task.id === 'string' &&
        typeof task.runId === 'string' &&
        /^(day|week|month):\d{4}-\d{2}-\d{2}$/.test(task.id)
      ) {
        await processReportTask(env, task);
      }
      message.ack();
    }
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(daily(env, new Date(controller.scheduledTime)));
  },
};
