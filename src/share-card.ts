import type { Report } from '../shared/schema';
import { addDays } from '../shared/metrics';
import { drawShareQr } from './share-qr';

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
  const aTracks = report.metrics.top_tracks.slice(0, 2).map((item) => item.track);
  const bTracks = report.b_side?.metrics.top_tracks.slice(0, 2).map((item) => item.track) ?? [];
  const covers = await Promise.all([...aTracks, ...bTracks].map((track) => cover(track.image)));
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法生成图片，请复制链接分享。');
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#172735';
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = '#eef3f7';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(1080, 0);
  ctx.lineTo(1080, 310);
  ctx.lineTo(0, 1030);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#a7b8cd';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 1030);
  ctx.lineTo(1080, 310);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = `700 37px ${sans}`;
  ctx.fillText('No Taste Today.', 72, 66);
  ctx.fillStyle = muted;
  ctx.font = `400 23px ${sans}`;
  ctx.fillText('听觉手记 / 双面刊', 72, 118);
  ctx.textAlign = 'right';
  ctx.fillText(
    report.demo ? '示例刊' : { day: '日记', week: '周刊', month: '月刊' }[report.type],
    1008,
    80,
  );
  ctx.textAlign = 'left';
  const dates =
    report.type === 'day'
      ? report.date.replaceAll('-', '.')
      : report.date.replaceAll('-', '.') +
        ' — ' +
        addDays(report.end_date, -1).replaceAll('-', '.');
  ctx.font = `500 22px ${sans}`;
  ctx.fillText(dates, 72, 173);
  ctx.fillStyle = '#345e8c';
  ctx.font = `600 25px ${sans}`;
  ctx.fillText('A 面 / Taste today.', 72, 225);
  ctx.fillStyle = ink;
  block(
    ctx,
    report.taste_comment.paragraphs.length ? report.taste_comment.title : '这一期的选曲',
    72,
    276,
    690,
    52,
    2,
    700,
  );
  const drawTrack = (
    track: (typeof aTracks)[number],
    image: HTMLImageElement | null,
    x: number,
    y: number,
    dark: boolean,
  ) => {
    const size = 168;
    if (image) {
      const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight),
        w = image.naturalWidth * scale,
        h = image.naturalHeight * scale;
      ctx.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h);
    } else {
      ctx.fillStyle = dark ? '#40576b' : '#b7cbd8';
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = dark ? '#bcb0d0' : '#eef3f7';
      [58, 40, 10].forEach((r) => {
        ctx.beginPath();
        ctx.arc(x + 84, y + 84, r, 0, Math.PI * 2);
        ctx.stroke();
      });
    }
    ctx.fillStyle = dark ? '#e9f0f5' : ink;
    block(ctx, track.name, x, y + 184, size, 23, 2, 600);
    ctx.fillStyle = dark ? '#a8bac9' : muted;
    block(ctx, track.artists.map((a) => a.name).join(', '), x, y + 245, size, 18, 1, 400);
  };
  aTracks.forEach((track, i) => drawTrack(track, covers[i], 72 + i * 220, 450, false));
  ctx.fillStyle = '#345e8c';
  block(ctx, report.taste_profile.tags.slice(0, 3).join(' / '), 72, 748, 280, 20, 1);
  ctx.font = `500 22px ${sans}`;
  ctx.fillText(`${report.metrics.plays} 次收录`, 72, 859);

  ctx.fillStyle = '#c4b1d4';
  ctx.font = `600 25px ${sans}`;
  ctx.fillText('B 面 / Not today.', 600, 655);
  ctx.fillStyle = '#e9f0f5';
  const bTitle = !report.b_side
    ? '这一期，还没有 B 面。'
    : !report.b_side.metrics.plays
      ? '这一面，今天留白。'
      : report.b_side.taste_comment.title;
  block(ctx, bTitle, 530, 696, 478, 46, 2, 700);
  bTracks.forEach((track, i) =>
    drawTrack(track, covers[aTracks.length + i], 610 + i * 230, 865, true),
  );
  if (!bTracks.length) {
    ctx.fillStyle = '#a8bac9';
    block(
      ctx,
      report.b_side ? '本期暂无跳过记录。' : '重新生成后，可查看双面手记。',
      560,
      943,
      430,
      26,
      2,
    );
  }
  ctx.fillStyle = '#c4b1d4';
  ctx.font = `500 22px ${sans}`;
  ctx.fillText(report.b_side ? `${report.b_side.metrics.plays} 次跳过` : 'B 面尚未生成', 72, 1080);
  ctx.fillStyle = '#a8bac9';
  ctx.font = `400 19px ${sans}`;
  ctx.fillText('同一份品味，两面的选择。', 72, 1121);
  ctx.strokeStyle = '#3c5060';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(72, 1216);
  ctx.lineTo(768, 1216);
  ctx.stroke();
  ctx.fillStyle = '#e9f0f5';
  ctx.font = `500 23px ${sans}`;
  block(
    ctx,
    publicUrl ? new URL(publicUrl).host : report.demo ? '示例听歌记录' : '私人手记',
    72,
    1246,
    650,
    23,
    1,
  );
  ctx.fillStyle = '#a8bac9';
  ctx.font = `400 19px ${sans}`;
  ctx.fillText('音乐来自 Spotify', 72, 1292);
  if (publicUrl) drawShareQr(ctx, publicUrl, 1008, 1162);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片生成失败，请重试。'))),
      'image/png',
    ),
  );
}
