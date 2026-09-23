import QRCode from 'qrcode';

// Integer-sized modules and a four-module quiet zone keep the exported PNG scannable.
export function drawShareQr(
  ctx: Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>,
  url: string | null,
  right: number,
  top: number,
  maxSize = 180,
) {
  if (!url) return;
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const quiet = 4;
  const scale = Math.max(1, Math.floor(maxSize / (modules.size + quiet * 2)));
  const size = (modules.size + quiet * 2) * scale;
  const left = right - size;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(left, top, size, size);
  ctx.fillStyle = '#000000';
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col))
        ctx.fillRect(left + (col + quiet) * scale, top + (row + quiet) * scale, scale, scale);
    }
  }
}
