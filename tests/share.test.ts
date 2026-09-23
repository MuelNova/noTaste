import test from 'node:test';
import assert from 'node:assert/strict';
import { reportLink } from '../src/share-card';

test('share links use the saved issue and never carry settings, auth state, or demo parameters', () => {
  for (const type of ['day', 'week', 'month'] as const) {
    const url = new URL(
      reportLink(
        { type, date: '2026-09-01' },
        'https://taste.example.com/api/admin/login?state=private&demo=1&settings=1#owner',
      ),
    );
    assert.equal(url.pathname, '/');
    assert.equal(url.search, `?type=${type}&date=2026-09-01`);
    assert.equal(url.hash, '');
  }
});

import jsQR from 'jsqr';
import { drawShareQr } from '../src/share-qr';

test('exported QR pixels decode to the exact day, week, or month link', () => {
  for (const type of ['day', 'week', 'month'] as const) {
    const width = 180;
    const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
    const ctx = {
      fillStyle: '',
      fillRect(x: number, y: number, w: number, h: number) {
        const channel = this.fillStyle === '#000000' ? 0 : 255;
        for (let row = y; row < y + h; row++) {
          for (let col = x; col < x + w; col++) {
            const offset = (row * width + col) * 4;
            pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = channel;
          }
        }
      },
    };
    const url = reportLink({ type, date: '2026-09-23' }, 'https://taste.nova.gal');
    drawShareQr(ctx, url, width, 0, width);
    assert.equal(jsQR(pixels, width, width)?.data, url);
  }
});

test('private reports do not draw a QR code', () => {
  drawShareQr(
    {
      fillStyle: '',
      fillRect() {
        assert.fail('Private report must not draw a QR');
      },
    },
    null,
    180,
    0,
  );
});
