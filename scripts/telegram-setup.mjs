import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const env = { ...parseEnv(readFileSync('.dev.vars', 'utf8')) };
async function call(method, body = {}) {
  const response = await fetch(
    'https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + method,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    },
  );
  const data = await response.json();
  if (!response.ok || !data.ok)
    throw new Error(
      'Telegram 请求失败，请检查 token、chat ID 和网络；getUpdates 不能与已有 webhook 同时使用。',
    );
  return data.result;
}
try {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('先在 .dev.vars 填写 TELEGRAM_BOT_TOKEN。');
  if (process.argv.includes('--test')) {
    if (!env.TELEGRAM_CHAT_ID) throw new Error('先在 .dev.vars 填写 TELEGRAM_CHAT_ID。');
    await call('sendMessage', {
      chat_id: env.TELEGRAM_CHAT_ID,
      text: 'No Taste Today：故障提醒测试成功。Spotify 授权续期失败时会通过这里通知你。',
    });
    console.log('测试消息已发送到配置的聊天。');
  } else {
    const updates = await call('getUpdates', { timeout: 0, limit: 100 });
    const chats = [
      ...new Map(
        updates
          .map((u) => u.message?.chat)
          .filter((c) => c?.type === 'private')
          .map((c) => [c.id, c]),
      ).values(),
    ];
    if (!chats.length) console.log('未找到私聊。请先向自己的 Bot 发送 /start 后再运行。');
    for (const chat of chats)
      console.log(
        JSON.stringify({ chat_id: chat.id, name: chat.first_name, username: chat.username }),
      );
    if (chats.length)
      console.log('确认属于你自己的私聊后，将 chat_id 填入 .dev.vars 的 TELEGRAM_CHAT_ID。');
  }
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith('Telegram 请求失败')
      ? error.message
      : env.TELEGRAM_BOT_TOKEN
        ? '连接未完成，请检查配置及网络。'
        : '先在 .dev.vars 填写 TELEGRAM_BOT_TOKEN。',
  );
  process.exitCode = 1;
}
