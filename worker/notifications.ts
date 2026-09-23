import { appUrl, type Env } from './env';
const QUIET_MS = 6 * 60 * 60 * 1000;

// Reserve before sending so multiple failing requests cannot spam the bot.
// A delivery failure permits another attempt after five minutes.
export async function notifySpotifyFailure(
  env: Env,
  reason: 'refresh' | 'credentials' | 'storage',
) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const now = new Date();
  try {
    const claimed = await env.DB.prepare(
      `INSERT INTO notifications(id,next_attempt_at) VALUES ('spotify-auth',?)
      ON CONFLICT(id) DO UPDATE SET next_attempt_at=excluded.next_attempt_at
      WHERE notifications.next_attempt_at<=?`,
    )
      .bind(new Date(now.getTime() + QUIET_MS).toISOString(), now.toISOString())
      .run();
    if (!claimed.meta.changes) return;
    const explanations = {
      refresh:
        'Spotify 授权续期失败，本次采集未能完成。若是暂时网络故障可稍后重试；如果授权已失效，请重新连接。',
      credentials: 'Spotify 应用凭证被拒绝，请检查应用配置，再重新连接 Spotify。',
      storage: '保存的 Spotify 授权无法读取，请检查加密配置或重新连接 Spotify。',
    };
    const response = await fetch(
      'https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text:
            'No Taste Today\n' +
            explanations[reason] +
            '\n主人登录／重新连接：' +
            appUrl(env) +
            '/api/admin/login',
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const result = (await response.json()) as { ok?: boolean };
    if (!response.ok || !result.ok) throw new Error('Telegram delivery failed');
    await env.DB.prepare(
      "UPDATE notifications SET sent_at=?,last_error=NULL WHERE id='spotify-auth'",
    )
      .bind(now.toISOString())
      .run();
  } catch {
    // Never return a fetch error containing the Telegram token URL to the client.
    try {
      await env.DB.prepare(
        "UPDATE notifications SET next_attempt_at=?,last_error='提醒发送失败，请检查 Telegram 配置或网络' WHERE id='spotify-auth'",
      )
        .bind(new Date(Date.now() + 300000).toISOString())
        .run();
    } catch {
      /* Original Spotify error still reaches the job. */
    }
  }
}
export async function clearSpotifyAlert(env: Env) {
  try {
    await env.DB.prepare("DELETE FROM notifications WHERE id='spotify-auth'").run();
  } catch {
    /* Notification availability must not break token storage. */
  }
}
