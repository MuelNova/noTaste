import { mkdirSync, writeFileSync } from 'node:fs';
const base = 'http://127.0.0.1:8787';
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Perth',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
for (const date of [yesterday, today]) {
  console.log('生成日期：' + date);
  const response = await fetch(base + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ type: 'day', date }),
  });
  const job = await response.json();
  console.log(
    JSON.stringify({
      status: response.status,
      job_status: job.status,
      stage: job.stage,
      error: job.error,
    }),
  );
  if (!response.ok || job.status === 'failed') {
    process.exitCode = 1;
    break;
  }
  const report = await (await fetch(base + '/api/reports?type=day&date=' + date)).json();
  console.log(
    JSON.stringify({
      plays: report.metrics?.plays,
      tracks: report.metrics?.tracks,
      report_status: report.status,
      warnings: report.warnings,
      recommendations: report.recommendations?.length,
      fun_facts: report.fun_facts?.length,
    }),
  );
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/live-report.json', JSON.stringify(report, null, 2));
  if (report.metrics?.plays > 0) break;
}
