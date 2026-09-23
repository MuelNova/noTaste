export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  KIMI_API_KEY: string;
  KIMI_BASE_URL: string;
  KIMI_MODEL: string;
  APP_URL: string;
  TIMEZONE: string;
  ADMIN_PASSWORD: string;
  TOKEN_ENCRYPTION_KEY: string;
  PUBLIC_REPORTS: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
};
export function isLocal(request: Request, env: Env) {
  const u = new URL(request.url);
  return (
    ['127.0.0.1', 'localhost'].includes(u.hostname) &&
    new URL(env.APP_URL || request.url).hostname === u.hostname
  );
}
export function appUrl(env: Env) {
  return env.APP_URL.replace(/\/$/, '');
}
