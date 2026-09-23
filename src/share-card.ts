import type { Report } from '../shared/schema';
import { addDays } from '../shared/metrics';

export function reportLink(report: Pick<Report, 'type' | 'date'>, origin: string) {
  const url = new URL('/', origin);
  url.searchParams.set('type', report.type);
  url.searchParams.set('date', report.date);
  return url.href;
}

const sans = '"DM Sans", "Noto Sans SC", sans-serif';
const ink = '#192c3b';
const muted = '#657481';

function lines(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const result: string[] = [];
  let line = '';
  const tokens =
    text
      .replace(/\s+/g, ' ')
      .trim()
      .match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|\s+|./gu) ?? [];
  for (const char of tokens) {
    if (
      line &&
      ctx.measureText(line + char).width > width &&
      !/^[，。！？、；：,.!?;:））》」』]$/u.test(char)
    ) {
      result.push(line.trim());
      line = '';
    }
    line += line ? char : char.trimStart();
  }
  if (line) result.push(line.trim());
  return result;
}
function block(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  maxLines: number,
  weight = 500,
) {
  let rows: string[];
  do {
    ctx.font = `${weight} ${size}px ${sans}`;
    rows = lines(ctx, text, width);
    if (rows.length <= maxLines || size <= 18) break;
    size -= 2;
  } while (true);
  // Only compact labels may need ellipsis; the report title always fits its 90-character limit.
  if (rows.length > maxLines) {
    rows = rows.slice(0, maxLines);
    let last = rows[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > width) last = last.slice(0, -1);
    rows[maxLines - 1] = last + '…';
  }
  rows.forEach((line, i) => ctx.fillText(line, x, y + i * size * 1.45));
}
function cover(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    let settled = false;
    const finish = (result: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = image.onerror = null;
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), 8000);
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = url;
  });
}

export async function renderShareCard(report: Report, publicUrl: string | null): Promise<Blob> {
  await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 2500))]);
  const tracks = report.metrics.top_tracks.slice(0, 3).map((item) => item.track);
  const covers = await Promise.all(tracks.map((track) => cover(track.image)));
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法生成图片，请复制链接分享。');
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#eef3f7';
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = '#173e54';
  ctx.fillRect(0, 0, 1080, 14);
  ctx.fillStyle = ink;
  ctx.font = `700 37px ${sans}`;
  ctx.fillText('No Taste Today.', 72, 66);
  ctx.fillStyle = muted;
  ctx.font = `400 23px ${sans}`;
  ctx.fillText('听觉手记', 72, 118);
  const period = { day: '日记', week: '周刊', month: '月刊' }[report.type];
  ctx.textAlign = 'right';
  ctx.fillText(report.demo ? '示例刊' : period, 1008, 80);
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#c8d5de';
  ctx.beginPath();
  ctx.moveTo(72, 174);
  ctx.lineTo(1008, 174);
  ctx.stroke();
  const dates =
    report.type === 'day'
      ? report.date.replaceAll('-', '.')
      : report.date.replaceAll('-', '.') +
        ' — ' +
        addDays(report.end_date, -1).replaceAll('-', '.');
  ctx.font = `500 24px ${sans}`;
  ctx.fillText(dates, 72, 209);
  ctx.fillStyle = ink;
  block(
    ctx,
    report.taste_comment.paragraphs.length ? report.taste_comment.title : '这一期的选曲',
    72,
    276,
    936,
    64,
    3,
    700,
  );
  ctx.fillStyle = '#345e8c';
  block(ctx, report.taste_profile.tags.slice(0, 3).join(' / '), 72, 554, 936, 27, 1);

  tracks.forEach((track, index) => {
    const x = 72 + index * 322;
    const image = covers[index];
    if (image) {
      // Album art is shown in full, without cropping or text over it.
      const scale = Math.min(292 / image.naturalWidth, 292 / image.naturalHeight);
      const w = image.naturalWidth * scale,
        h = image.naturalHeight * scale;
      ctx.drawImage(image, x + (292 - w) / 2, 638 + (292 - h) / 2, w, h);
    } else {
      ctx.fillStyle = ['#b7cbd8', '#c5bed2', '#a9c9c9'][index];
      ctx.fillRect(x, 638, 292, 292);
      ctx.strokeStyle = '#eef3f7';
      [94, 69, 17].forEach((r) => {
        ctx.beginPath();
        ctx.arc(x + 146, 784, r, 0, Math.PI * 2);
        ctx.stroke();
      });
    }
    ctx.fillStyle = ink;
    block(ctx, track.name, x, 954, 292, 27, 2, 600);
    ctx.fillStyle = muted;
    block(ctx, track.artists.map((a) => a.name).join(', '), x, 1042, 292, 22, 2, 400);
  });
  if (!tracks.length) {
    ctx.fillStyle = muted;
    block(ctx, '这一期，留一点空白。', 72, 748, 936, 44, 2);
  }
  ctx.strokeStyle = '#c8d5de';
  ctx.beginPath();
  ctx.moveTo(72, 1150);
  ctx.lineTo(1008, 1150);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = `500 25px ${sans}`;
  ctx.fillText(`${report.metrics.tracks} 首歌 / ${report.metrics.plays} 次收集到的播放`, 72, 1188);
  ctx.fillStyle = muted;
  ctx.font = `400 21px ${sans}`;
  ctx.fillText(
    publicUrl ? new URL(publicUrl).host : report.demo ? '示例听歌记录' : '私人手记',
    72,
    1260,
  );
  ctx.textAlign = 'right';
  ctx.fillText('音乐来自 Spotify', 1008, 1260);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片生成失败，请重试。'))),
      'image/png',
    ),
  );
}
