const urls = [
  'https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=%22The%20Hills%22%20%22The%20Weeknd%22%20song&gsrnamespace=0&gsrlimit=2&prop=extracts%7Cinfo&explaintext=1&exchars=7000&inprop=url',
  'https://en.wikipedia.org/api/rest_v1/page/summary/The_Hills_(song)',
];
for (const url of urls) {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'NoTasteToday/0.1 (personal music journal)' },
      signal: AbortSignal.timeout(20000),
    });
    console.log(r.status, url);
    if (r.ok) {
      const d = await r.json();
      console.log(JSON.stringify(d).slice(0, 1800));
    }
  } catch (e) {
    console.log(e.cause?.code ?? e.message);
  }
}
