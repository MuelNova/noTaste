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
