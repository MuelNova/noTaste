import { z } from 'zod';
export const genres = [
  '流行',
  '摇滚',
  '嘻哈 / R&B',
  '电子',
  '民谣 / 唱作',
  '爵士 / 灵魂',
  '古典 / 器乐',
  '其他',
  '未知',
] as const;
export type PeriodType = 'day' | 'week' | 'month';
export type Track = {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album: string;
  image: string | null;
  url: string;
  release_date: string;
  duration_ms: number;
};
export type Play = { track: Track; played_at: string; context: string | null };
export const classificationSchema = z.object({
  track_id: z.string(),
  genre: z.enum(genres),
  subgenres: z.array(z.string().max(40)).max(3),
  textures: z.array(z.string().max(20)).max(3),
});
export type Classification = z.infer<typeof classificationSchema>;
export type Source = { id: string; track_id: string; title: string; url: string; excerpt: string };
export const bEditorialSchema = z.object({
  taste_comment: z.object({
    title: z.string().min(1).max(90),
    standfirst: z.string().max(200),
    paragraphs: z.array(z.string().min(1).max(1400)).min(1).max(3),
    track_ids: z.array(z.string()).max(8),
  }),
  taste_profile: z.object({
    headline: z.string().max(80),
    tags: z.array(z.string().max(30)).max(6),
  }),
  discoveries: z
    .array(
      z.object({
        title: z.string().max(70),
        body: z.string().max(350),
        track_ids: z.array(z.string()).max(6),
      }),
    )
    .max(3),
});
export const editorialSchema = z.object({
  b_side: bEditorialSchema.nullable(),
  taste_comment: z.object({
    title: z.string().min(1).max(90),
    standfirst: z.string().max(200),
    paragraphs: z.array(z.string().min(1).max(1400)).min(1).max(6),
    track_ids: z.array(z.string()).max(8),
  }),
  taste_profile: z.object({
    headline: z.string().max(80),
    tags: z.array(z.string().max(30)).max(6),
  }),
  discoveries: z
    .array(
      z.object({
        title: z.string().max(70),
        body: z.string().max(350),
        track_ids: z.array(z.string()).max(6),
      }),
    )
    .max(4),
  fun_facts: z
    .array(
      z.object({
        title: z.string().max(100),
        body: z.string().max(500),
        listen_for: z.string().max(200),
        track_id: z.string(),
        source_id: z.string(),
        source_quote: z.string().max(350),
      }),
    )
    .max(2),
  recommendations: z
    .array(
      z.object({
        name: z.string().max(150),
        artist: z.string().max(150),
        direction: z.enum(['顺着口味', '跨一步', '意外之选']),
        reason: z.string().max(350),
        connection_track_id: z.string(),
      }),
    )
    .max(3),
  taste_evolution: z
    .object({ headline: z.string().max(100), body: z.string().max(500) })
    .nullable(),
});
export type Editorial = z.infer<typeof editorialSchema>;
export type Metrics = {
  plays: number;
  tracks: number;
  artists: number;
  repeat_ratio: number | null;
  new_artists: number | null;
  hours: number[];
  weekdays: number[];
  genres: { name: string; count: number }[];
  decades: { name: string; count: number }[];
  contexts: { name: string; count: number }[];
  top_tracks: { track: Track; count: number }[];
  top_artists: { name: string; count: number }[];
  observed_days: number;
};
export type ReportSide = z.infer<typeof bEditorialSchema> & { metrics: Metrics; tracks: Track[] };
export type Report = {
  b_side?: ReportSide;
  collected_plays?: number;
  skip_rule?: 'gap-10s-v1';
  id: string;
  type: PeriodType;
  date: string;
  end_date: string;
  timezone: string;
  demo: boolean;
  generated_at: string;
  status: 'complete' | 'partial';
  warnings: string[];
  metrics: Metrics;
  previous: Metrics | null;
  tracks: Track[];
  taste_comment: Editorial['taste_comment'];
  taste_profile: Editorial['taste_profile'];
  discoveries: Editorial['discoveries'];
  fun_facts: (Editorial['fun_facts'][number] & { source: Omit<Source, 'excerpt'> })[];
  recommendations: (Editorial['recommendations'][number] & { track: Track })[];
  taste_evolution: Editorial['taste_evolution'];
  model: string;
  prompt_version: string;
};
