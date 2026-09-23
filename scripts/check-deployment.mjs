const origin = process.env.APP_URL;
if (!origin) throw new Error('APP_URL is required');
let ok = false;
for (let attempt = 0; attempt < 6; attempt++) {
  try {
    const response = await fetch(new URL('/api/status', origin), {
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (
      !response.ok ||
      data.local !== false ||
      data.access_configured !== true ||
      data.verified_owner !== false
    )
      throw new Error('Status check failed');
    const demo = await fetch(new URL('/api/demo', origin), { signal: AbortSignal.timeout(10000) });
    if (demo.status !== 404) throw new Error('Demo must not be available in production');
    console.log('Production responds correctly; anonymous access does not grant owner privileges.');
    ok = true;
    break;
  } catch {
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}
if (!ok) {
  console.error('Production health check failed. Check the domain and deployment logs.');
  process.exitCode = 1;
}
