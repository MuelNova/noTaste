import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const env = parseEnv(readFileSync('.dev.vars', 'utf8'));
for (const [label, operation] of [
  [
    'Spotify',
    () =>
      fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
        signal: AbortSignal.timeout(20000),
      }),
  ],
  [
    'Kimi',
    () =>
      fetch(env.KIMI_BASE_URL.replace(/\/$/, '') + '/models', {
        headers: { Authorization: 'Bearer ' + env.KIMI_API_KEY },
        signal: AbortSignal.timeout(20000),
      }),
  ],
]) {
  try {
    const response = await operation();
    console.log(label + ': HTTP ' + response.status);
    if (label === 'Kimi' && response.ok) {
      const data = await response.json();
      console.log('配置模型可用: ' + Boolean(data.data?.some((x) => x.id === env.KIMI_MODEL)));
      console.log(
        'Kimi 模型: ' +
          data.data
            ?.filter((x) => x.id.startsWith('kimi-'))
            .map((x) => x.id)
            .join(', '),
      );
    }
  } catch (e) {
    console.log(label + ': ' + (e.cause?.code ?? e.name));
    process.exitCode = 1;
  }
}
