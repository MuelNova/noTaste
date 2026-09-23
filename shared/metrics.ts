import { genres, type Classification, type Metrics, type Play } from './schema';
export function localDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function addDays(date: string, days: number) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function periodBounds(type: 'day' | 'week' | 'month', date: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date
  )
    throw new Error('无效日期');
  let start = date;
  if (type === 'week')
    start = addDays(date, -((new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7));
  if (type === 'month') start = date.slice(0, 7) + '-01';
  const end =
    type === 'day'
      ? addDays(start, 1)
      : type === 'week'
        ? addDays(start, 7)
        : new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7), 1)).toISOString().slice(0, 10);
  return { start, end };
}
export function previousBounds(type: 'day' | 'week' | 'month', start: string) {
  return periodBounds(type, addDays(start, -1));
}
export function dedupe(plays: Play[]): Play[] {
  return [...new Map(plays.map((p) => [p.track.id + '|' + p.played_at, p])).values()].sort((a, b) =>
    a.played_at.localeCompare(b.played_at),
  );
}
export function calculateMetrics(
  raw: Play[],
  labels: Classification[],
  timezone: string,
  priorArtistIds?: Set<string>,
): Metrics {
  const plays = dedupe(raw),
    tracks = new Map(plays.map((p) => [p.track.id, p.track]));
  const artists = new Set(plays.flatMap((p) => p.track.artists.map((a) => a.id)));
  const classes = new Map(labels.map((l) => [l.track_id, l]));
  const hours = Array(24).fill(0),
    weekdays = Array(7).fill(0),
    days = new Set<string>();
  const genreCounts = new Map<string, number>(genres.map((g) => [g, 0]));
  const decades = new Map<string, number>(),
    contexts = new Map<string, number>(),
    trackCounts = new Map<string, number>(),
    artistCounts = new Map<string, { name: string; count: number }>();
  const hourFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  });
  for (const p of plays) {
    const d = new Date(p.played_at),
      day = localDate(d, timezone);
    days.add(day);
    hours[Number(hourFormat.format(d))]++;
    weekdays[(new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7]++;
    const genre = classes.get(p.track.id)?.genre ?? '未知';
    genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    const year = parseInt(p.track.release_date);
    const decade = year ? `${Math.floor(year / 10) * 10}s` : '未知';
    decades.set(decade, (decades.get(decade) ?? 0) + 1);
    const context = p.context ?? '未知';
    contexts.set(context, (contexts.get(context) ?? 0) + 1);
    trackCounts.set(p.track.id, (trackCounts.get(p.track.id) ?? 0) + 1);
    for (const a of p.track.artists) {
      const item = artistCounts.get(a.id) ?? { name: a.name, count: 0 };
      item.count += 1 / p.track.artists.length;
      artistCounts.set(a.id, item);
    }
  }
  const sorted = (map: Map<string, number>) =>
    [...map]
      .map(([name, count]) => ({ name, count }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);
  return {
    plays: plays.length,
    tracks: tracks.size,
    artists: artists.size,
    repeat_ratio: plays.length ? (plays.length - tracks.size) / plays.length : null,
    new_artists: priorArtistIds?.size
      ? [...artists].filter((id) => !priorArtistIds.has(id)).length
      : null,
    hours,
    weekdays,
    genres: sorted(genreCounts),
    decades: sorted(decades),
    contexts: sorted(contexts),
    top_tracks: [...trackCounts]
      .map(([id, count]) => ({ track: tracks.get(id)!, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    top_artists: [...artistCounts.values()].sort((a, b) => b.count - a.count).slice(0, 6),
    observed_days: days.size,
  };
}
