import { calculateMetrics, periodBounds, addDays } from './metrics';
import { emptyBSide } from './sides';
import type { Classification, PeriodType, Play, Report, Track } from './schema';
const records = [
  ['Idioteque', 'Radiohead', 'Kid A', '2000', '电子', 'IDM'],
  ['Roads', 'Portishead', 'Dummy', '1994', '电子', 'Trip-hop'],
  ['Alison', 'Slowdive', 'Souvlaki', '1993', '摇滚', 'Shoegaze'],
  ['Everything in Its Right Place', 'Radiohead', 'Kid A', '2000', '电子', 'Art pop'],
  ['Jóga', 'Björk', 'Homogenic', '1997', '电子', 'Art pop'],
  ['Teardrop', 'Massive Attack', 'Mezzanine', '1998', '电子', 'Trip-hop'],
  ['Glory Box', 'Portishead', 'Dummy', '1994', '电子', 'Trip-hop'],
  ['When the Sun Hits', 'Slowdive', 'Souvlaki', '1993', '摇滚', 'Shoegaze'],
  ['Reckoner', 'Radiohead', 'In Rainbows', '2007', '摇滚', 'Art rock'],
  ['Angel', 'Massive Attack', 'Mezzanine', '1998', '电子', 'Trip-hop'],
  ['Hyperballad', 'Björk', 'Post', '1995', '电子', 'Art pop'],
  ['Sugar for the Pill', 'Slowdive', 'Slowdive', '2017', '摇滚', 'Dream pop'],
];
export const demoTracks: Track[] = records.map(([name, artist, album, year], i) => ({
  id: 'demo-' + i,
  name,
  artists: [{ id: artist, name: artist }],
  album,
  image: null,
  url: 'https://open.spotify.com/search/' + encodeURIComponent(artist + ' ' + name),
  release_date: year,
  duration_ms: 240000,
}));
const labels = records.map((r, i) => ({
  track_id: 'demo-' + i,
  genre: r[4],
  subgenres: [r[5]],
  textures: [],
})) as Classification[];
export function demoReport(type: PeriodType = 'day', date = '2026-09-22'): Report {
  if (!['day', 'week', 'month'].includes(type)) type = 'day';
  const { start, end } = periodBounds(type, date);
  const days =
    type === 'day'
      ? 1
      : type === 'week'
        ? 7
        : Math.min(30, Math.round((Date.parse(end) - Date.parse(start)) / 86400000));
  const plays: Play[] = Array.from({ length: days }, (_, day) =>
    Array.from({ length: 32 }, (_, i) => ({
      track: demoTracks[(i + day) % demoTracks.length],
      played_at:
        addDays(start, day) +
        'T' +
        String(1 + Math.floor(i / 3)).padStart(2, '0') +
        ':' +
        String((i % 3) * 15).padStart(2, '0') +
        ':00.000Z',
      context: i % 5 ? 'playlist' : 'album',
    })),
  ).flat();
  const metrics = calculateMetrics(
    plays,
    labels,
    'Australia/Perth',
    new Set(['Radiohead', 'Portishead', 'Slowdive']),
  );
  const previous =
    type === 'day'
      ? null
      : calculateMetrics(
          plays
            .filter((_, i) => i % 4 !== 0)
            .map((p) => ({ ...p, track: demoTracks[(+p.track.id.split('-')[1] + 2) % 12] })),
          labels,
          'Australia/Perth',
        );
  const rec = (name: string, artist: string, album: string, id: string): Track => ({
    id,
    name,
    artists: [{ id: artist, name: artist }],
    album,
    image: null,
    url: 'https://open.spotify.com/search/' + encodeURIComponent(artist + ' ' + name),
    release_date: '',
    duration_ms: 0,
  });
  return {
    id: type + ':' + start,
    type,
    date: start,
    end_date: end,
    timezone: 'Australia/Perth',
    demo: true,
    generated_at: new Date().toISOString(),
    status: 'complete',
    warnings: [],
    metrics,
    previous,
    tracks: demoTracks,
    taste_comment: {
      title:
        type === 'day'
          ? '失真的吉他，也有电子的体温。'
          : type === 'week'
            ? '沿着低频，一路走进雾里。'
            : '这个月，声音的质地比流派更重要。',
      standfirst:
        'Radiohead、Portishead 与 Slowdive 之间，藏着一种相当一致的选择：旋律很好听，但声音不必光滑。',
      paragraphs: [
        '把《Idioteque》和《Alison》放在同一天，乍看像是从电子跳到了盯鞋。真正连接它们的，是让声音占满空间的方式：前者靠循环和不安定的节奏，后者靠漫开的吉他与埋进混响的人声。曲风在换，对声音质地的偏爱却很稳定。',
        'Portishead 把这条线拉向了另一端。《Roads》的人声更靠前，留白也更多；它让前面那些密集的声音有了对照。这份选曲最有意思的地方，正在这种密度的切换里。',
        '审美坐标很清楚，也相当稳妥：这些都是各自领域里反复被聆听的作品。下一次真正值得期待的，是沿着这种对质地的敏感，找到一个还没被熟悉名字占据的位置。',
      ],
      track_ids: ['demo-0', 'demo-1', 'demo-2'],
    },
    taste_profile: {
      headline: '偏爱有颗粒感的声音',
      tags: ['Trip-hop', 'Shoegaze', 'Art pop', '低频', '空间感'],
    },
    discoveries: [
      {
        title: '共同点在声音里',
        body: '《Idioteque》的循环与《Alison》的吉他并不属于同一种风格，但都把声音的层次放在很显眼的位置。',
        track_ids: ['demo-0', 'demo-2'],
      },
      {
        title: '给密集的声音留个空隙',
        body: '《Roads》在人声周围留下空间，与这份选曲里的吉他声墙形成对照。',
        track_ids: ['demo-1'],
      },
    ],
    fun_facts: [
      {
        title: '一段七十年代的计算机音乐，进入了《Idioteque》',
        body: '《Idioteque》使用了 Paul Lansky 的计算机音乐作品《Mild und leise》中的采样。那段听起来属于千禧年的声音，实际连接着更早的电子音乐实验。',
        listen_for: '留意贯穿歌曲的合成器和弦循环。',
        track_id: 'demo-0',
        source_id: 'wiki-idioteque',
        source_quote: 'It contains samples of two 1970s computer music compositions.',
        source: {
          id: 'wiki-idioteque',
          track_id: 'demo-0',
          title: 'Idioteque · Wikipedia',
          url: 'https://en.wikipedia.org/wiki/Idioteque',
        },
      },
    ],
    recommendations: [
      {
        name: 'Nude',
        artist: 'Radiohead',
        direction: '顺着口味',
        reason: '沿着对人声与空间的偏好，听一个更舒展的 Radiohead。',
        connection_track_id: 'demo-3',
        track: rec('Nude', 'Radiohead', 'In Rainbows', 'rec-1'),
      },
      {
        name: 'You Wish',
        artist: 'Nightmares on Wax',
        direction: '跨一步',
        reason: '保留低频和循环，把气氛移向更松弛的器乐节拍。',
        connection_track_id: 'demo-1',
        track: rec('You Wish', 'Nightmares on Wax', 'In a Space Outta Sound', 'rec-2'),
      },
      {
        name: 'Sea, Swallow Me',
        artist: 'Cocteau Twins',
        direction: '意外之选',
        reason: '沿着 Slowdive 的空间感，走向更模糊的人声轮廓。',
        connection_track_id: 'demo-2',
        track: rec('Sea, Swallow Me', 'Cocteau Twins', 'The Moon and the Melodies', 'rec-3'),
      },
    ],
    taste_evolution: previous
      ? {
          headline: '声音的共同点，慢慢比风格更显眼。',
          body: '这一期的示例把电子与吉他音乐放在一起比较。它们的边界依然存在，对空间与重复的偏好却成为贯穿选曲的线索。',
        }
      : null,
    model: 'demo',
    prompt_version: '3',
    skip_rule: 'gap-10s-v1',
    collected_plays: metrics.plays + 3 * days,
    b_side: {
      ...emptyBSide('Australia/Perth'),
      metrics: calculateMetrics(
        plays
          .filter((_, i) => i % 32 < 3)
          .map((p, i) => ({ ...p, track: demoTracks[[4, 7, 0][i % 3]] })),
        labels,
        'Australia/Perth',
      ),
      tracks: [demoTracks[4], demoTracks[7], demoTracks[0]],
      taste_comment: {
        title: '有些熟悉的声音，今天先略过。',
        standfirst: '同一首《Idioteque》，既出现在留下的选曲里，也在这一面被略过。',
        paragraphs: [
          '《Jóga》《When the Sun Hits》与《Idioteque》落在这一面，把熟悉的电子与吉他音乐又排列了一次。它们与 A 面的距离并不遥远；这份示例里的取舍，发生在具体的播放之间。',
          '《Idioteque》同时出现在两面，正是这张唱片最值得保留的矛盾。重复出现与偶尔略过可以并存，一次切歌并不会抹掉另一面的选择。',
        ],
        track_ids: ['demo-4', 'demo-7', 'demo-0'],
      },
      taste_profile: { headline: '熟悉，也可以留待下次', tags: ['Art pop', 'Shoegaze', 'IDM'] },
      discoveries: [
        {
          title: '一首歌，两种去向',
          body: '《Idioteque》在这一期示例中既被收录，也留下了跳过记录。两面的交集比单纯的喜欢与不喜欢更有意思。',
          track_ids: ['demo-0'],
        },
      ],
    },
  };
}
