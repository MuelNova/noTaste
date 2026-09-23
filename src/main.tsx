import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Headphones,
  Settings2,
  X,
  Heart,
  Check,
  RefreshCw,
  BookOpen,
  AudioLines,
  Link2,
} from 'lucide-react';
import { addDays, localDate, periodBounds } from '../shared/metrics';
import { demoReport } from '../shared/demo';
import type { PeriodType, Report, Track } from '../shared/schema';
import './styles.css';
type Generation = {
  verified_owner: boolean;
  next_allowed_at: string | null;
  cooldown_seconds: number;
  running: boolean;
  stage: string | null;
};
type Status = {
  owner: boolean;
  verified_owner: boolean;
  auth_method: 'password' | 'cloudflare' | null;
  access_configured: boolean;
  password_configured: boolean;
  generation_ready: boolean;
  telegram_configured?: boolean;
  connected?: boolean;
  spotify_configured?: boolean;
  kimi_configured?: boolean;
  public_reports: boolean;
  timezone: string;
  local: boolean;
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? '请求失败');
  return data;
}
const percent = (n: number | null) => (n === null ? '—' : Math.round(n * 100) + '%');
function Cover({ track, large = false }: { track: Track; large?: boolean }) {
  return (
    <span
      className={'cover ' + (large ? 'large' : '')}
      style={
        {
          '--cover-hue': String([...track.name].reduce((a, b) => a + b.charCodeAt(0), 0) % 360),
        } as React.CSSProperties
      }
    >
      {track.image ? (
        <img src={track.image} alt={track.album + ' 封面'} loading="lazy" />
      ) : (
        <span>{track.artists[0]?.name.slice(0, 2)}</span>
      )}
    </span>
  );
}
function TrackLink({ track }: { track: Track }) {
  return (
    <a
      href={track.url}
      target="_blank"
      rel="noreferrer"
      className="track-link"
      aria-label={'在 Spotify 打开 ' + track.name}
    >
      <ArrowUpRight size={18} />
    </a>
  );
}
function App() {
  const initial = new URLSearchParams(location.search);
  const [type, setType] = useState<PeriodType>(
    (['day', 'week', 'month'].includes(initial.get('type') ?? '')
      ? initial.get('type')
      : 'day') as PeriodType,
  );
  const [date, setDate] = useState(initial.get('date') ?? localDate(new Date(), 'Australia/Perth'));
  const [status, setStatus] = useState<Status | null>(null),
    [report, setReport] = useState<Report | null>(null),
    [demo, setDemo] = useState(initial.get('demo') === '1');
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [settings, setSettings] = useState(initial.get('settings') === '1'),
    [password, setPassword] = useState('');
  const [generating, setGenerating] = useState(false),
    [stage, setStage] = useState(''),
    [archive, setArchive] = useState<{ date: string; title: string }[]>([]);
  const [feedback, setFeedback] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState(''),
    [metricView, setMetricView] = useState<'hours' | 'decades'>('hours');
  const [revision, setRevision] = useState(0);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const previousRunning = useRef(false);
  const refreshGeneration = () =>
    api<Generation>('/api/generation')
      .then((g) => {
        setGeneration(g);
        if (previousRunning.current && !g.running) setRevision((v) => v + 1);
        previousRunning.current = g.running;
      })
      .catch(() => {});
  useEffect(() => {
    if (!status || (!status.owner && !status.public_reports)) return;
    void refreshGeneration();
    const timer = setInterval(() => {
      void refreshGeneration();
    }, 10000);
    return () => clearInterval(timer);
  }, [status, revision]);
  const [collection, setCollection] = useState<{
    plays: number;
    first: string | null;
    last: string | null;
    job: { status: string; stage: string; error?: string } | null;
  } | null>(null);
  const refreshStatus = () =>
    api<Status>('/api/status')
      .then(setStatus)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void refreshStatus();
  }, []);
  useEffect(() => {
    if (!status) return;
    if (demo && !status.local) {
      setDemo(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setCollection(null);
    async function load() {
      try {
        if (demo) {
          if (!cancelled) {
            setReport(demoReport(type, date));
            setArchive([]);
          }
          return;
        }
        if (!status!.owner && !status!.public_reports) {
          if (!cancelled) setReport(null);
          return;
        }
        if (status!.owner) {
          const sample = await api<NonNullable<typeof collection>>(
            '/api/collection?type=' + type + '&date=' + date,
          );
          if (!cancelled) setCollection(sample);
        }
        const list = await api<{ date: string; title: string }[]>('/api/reports?type=' + type);
        if (cancelled) return;
        setArchive(list);
        if (!list.some((x) => x.date === periodBounds(type, date).start)) {
          setReport(null);
          return;
        }
        const r = await api<Report>('/api/reports?type=' + type + '&date=' + date);
        if (!cancelled) setReport(r);
      } catch (e) {
        if (!cancelled) {
          setReport(null);
          setError((e as Error).message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('type', type);
    u.searchParams.set('date', date);
    if (demo) u.searchParams.set('demo', '1');
    history.replaceState({}, '', u);
    return () => {
      cancelled = true;
    };
  }, [status, demo, type, date, revision]);
  useEffect(() => {
    if (status?.owner && !demo)
      void api<{ track_id: string; value: string }[]>('/api/feedback')
        .then((rows) => setFeedback(Object.fromEntries(rows.map((r) => [r.track_id, r.value]))))
        .catch(() => {});
    else {
      try {
        setFeedback(JSON.parse(localStorage.getItem('taste-demo-feedback') ?? '{}'));
      } catch {
        setFeedback({});
      }
    }
  }, [status, demo]);
  useEffect(() => {
    if (collection?.job?.status !== 'running' || demo) return;
    const timer = setInterval(() => {
      void api<NonNullable<typeof collection>>('/api/collection?type=' + type + '&date=' + date)
        .then((sample) => {
          setCollection(sample);
          if (sample.job?.status !== 'running') setRevision((v) => v + 1);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [collection?.job?.status, demo, type, date]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function generateReport() {
    setGenerating(true);
    setError('');
    setStage('准备采集播放记录');
    const id = type + ':' + periodBounds(type, date).start;
    const timer = setInterval(() => {
      void api<{ stage: string } | null>(
        status?.owner ? '/api/jobs?id=' + encodeURIComponent(id) : '/api/generation',
      )
        .then((j) => j && setStage(j.stage))
        .catch(() => {});
    }, 2500);
    try {
      const job = await api<{ status: string; error?: string }>('/api/generate', { type, date });
      if (job.status === 'failed') throw new Error(job.error ?? '生成失败');
      setDemo(false);
      setRevision((v) => v + 1);
      setNotice(job.status === 'partial' ? '已保存，可以查看或重试未完成部分' : '这一期已生成');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      clearInterval(timer);
      setGenerating(false);
      void refreshGeneration();
    }
  }
  async function react(track: Track, value: string) {
    try {
      if (demo) {
        const next = { ...feedback, [track.id]: value };
        setFeedback(next);
        localStorage.setItem('taste-demo-feedback', JSON.stringify(next));
        setNotice('示例反馈仅保存在本机');
      } else {
        await api('/api/feedback', { track_id: track.id, value });
        setFeedback((f) => ({ ...f, [track.id]: value }));
        setNotice('已记下，后续推荐会参考这条反馈');
      }
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  const move = (direction: number) => {
    if (type === 'day') setDate(addDays(date, direction));
    else if (type === 'week') setDate(addDays(date, direction * 7));
    else {
      const d = new Date(date + 'T12:00:00Z');
      setDate(
        new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + direction, 1))
          .toISOString()
          .slice(0, 10),
      );
    }
  };
  const currentTracks = report?.tracks ?? [];
  const findTrack = (id: string) => currentTracks.find((t) => t.id === id);
  const total = report?.metrics.plays ?? 0;
  const today = localDate(new Date(), status?.timezone || 'Australia/Perth');
  const rightPeriod =
    date <= today && (status?.verified_owner || (type === 'day' && date === today));
  const waiting = !!generation?.next_allowed_at && !status?.verified_owner;
  const canGenerate = !!(
    status?.generation_ready &&
    generation &&
    rightPeriod &&
    !waiting &&
    !generation.running &&
    !generating
  );
  const nextTime = generation?.next_allowed_at
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: status?.timezone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(generation.next_allowed_at))
    : '';
  const generationLabel =
    generating || generation?.running
      ? '正在生成'
      : !rightPeriod
        ? '仅限当天日报'
        : waiting
          ? nextTime + ' 后可生成'
          : report
            ? '重新生成'
            : '生成这一期';
  return (
    <>
      <header className="site-header">
        <a className="brand" href="/" aria-label="No Taste Today 首页">
          <Disc3 size={28} />
          <span>
            No Taste Today<span className="brand-sub">听觉手记</span>
          </span>
        </a>
        <div className="header-right">
          <span className="edition">A journal of personal taste</span>
          <button className="icon-button" onClick={() => setSettings(true)} aria-label="连接与设置">
            <Settings2 size={21} />
          </button>
        </div>
      </header>
      <main>
        <div className="journal-nav">
          <div className="period-switch" role="group" aria-label="报告周期">
            {(['day', 'week', 'month'] as const).map((t) => (
              <button
                key={t}
                disabled={generating}
                aria-pressed={type === t}
                onClick={() => setType(t)}
              >
                {{ day: '日记', week: '周刊', month: '月刊' }[t]}
              </button>
            ))}
          </div>
          <div className="date-nav">
            <button
              className="today-button"
              disabled={generating}
              onClick={() => setDate(localDate(new Date(), status?.timezone || 'Australia/Perth'))}
            >
              今天
            </button>
            <button disabled={generating} onClick={() => move(-1)} aria-label="上一期">
              <ChevronLeft size={18} />
            </button>
            <input
              aria-label="选择日期"
              type="date"
              value={date}
              disabled={generating}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
            <button disabled={generating} onClick={() => move(1)} aria-label="下一期">
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="view-switch">
            {status?.local && (
              <button disabled={generating} onClick={() => setDemo(!demo)}>
                {demo ? '查看真实手记' : '浏览示例刊'}
              </button>
            )}
            {(status?.owner || status?.public_reports) && (
              <button
                className="generate"
                disabled={!canGenerate}
                onClick={() => void generateReport()}
              >
                <RefreshCw size={15} className={generating ? 'spinning' : ''} />
                {generationLabel}
              </button>
            )}
          </div>
        </div>
        {!demo && (
          <div className="generation-policy">
            <span>
              {status?.verified_owner
                ? '主人已验证 · 不限间隔，可重生成历史报告'
                : '普通模式 · 仅当天日报 · 所有访问者共用 3 小时间隔'}
            </span>
            {!status?.verified_owner && <button onClick={() => setSettings(true)}>主人登录</button>}
          </div>
        )}
        {demo && (
          <div className="sample-banner">
            <span>示例刊</span>模拟听歌记录与示例乐评。歌曲链接打开 Spotify 搜索。
          </div>
        )}
        {(generating || generation?.running || collection?.job?.status === 'running') && (
          <div className="progress-note" role="status">
            <AudioLines size={20} />
            {stage || generation?.stage || collection?.job?.stage}
            ，请保持页面打开。通常需要一两分钟。
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setRevision((v) => v + 1)}>重新加载</button>
          </div>
        )}
        {!demo && collection && collection.plays > 0 && (
          <div className="collection-note">
            已收集 {collection.plays} 次播放
            {collection.last &&
              '，最近一条 ' +
                new Intl.DateTimeFormat('zh-CN', {
                  timeZone: status?.timezone,
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(collection.last))}
            。{collection.job?.status === 'running' ? '正在生成这一期的内容。' : ''}
          </div>
        )}
        {loading ? (
          <div className="empty">
            <Disc3 size={42} />
            <h1>正在翻开这一期…</h1>
          </div>
        ) : !report ? (
          <div className="empty">
            <Headphones size={48} />
            <p className="muted">No Taste Today</p>
            <h1>{status?.connected ? '这一期，还没有落笔。' : '你的音乐，值得一篇好乐评。'}</h1>
            <p>
              {status?.connected
                ? '选一个日期，生成乐评、风格画像和歌曲故事。周刊与月刊会汇总已经保存的播放记录。'
                : '这里记录站点主人的听歌品味。访客无需连接 Spotify，报告生成后即可阅读。'}
            </p>
            <div className="empty-actions">
              {status?.verified_owner && !status.connected ? (
                <a className="primary-button" href="/api/auth/spotify/start">
                  连接 Spotify <Link2 size={18} />
                </a>
              ) : status?.owner || status?.public_reports ? (
                <button
                  className="primary-button"
                  disabled={!canGenerate}
                  onClick={() => void generateReport()}
                >
                  {generationLabel}
                </button>
              ) : null}
              {status?.local && (
                <button className="secondary-button" onClick={() => setDemo(true)}>
                  先读一期示例
                </button>
              )}
            </div>
            {!status?.owner && (
              <button className="text-button" onClick={() => setSettings(true)}>
                主人登录
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="issue-meta">
              <span>
                {report.date.replaceAll('-', '.')}{' '}
                {type !== 'day' && '— ' + addDays(report.end_date, -1).replaceAll('-', '.')}
              </span>
              <span>
                收集到 {total} 次播放 · {report.metrics.observed_days} 天有记录
              </span>
            </div>
            <section className="opening">
              <article className="review">
                <div className="section-caption">
                  <span>Taste comment</span>
                  <span>关于这一期的选择</span>
                </div>
                <h1>{report.taste_comment.title}</h1>
                <p className="standfirst">{report.taste_comment.standfirst}</p>
                <div className="review-copy">
                  {report.taste_comment.paragraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
                <div className="review-foot">
                  <span>AI 乐评 · 观点与音乐标签由模型生成</span>
                  <span>{report.demo ? '示例文本' : report.model}</span>
                </div>
              </article>
              <aside className="profile">
                <div className="profile-top">
                  <AudioLines size={25} />
                  <span>这一期的声音</span>
                </div>
                <h2>{report.taste_profile.headline}</h2>
                <div className="tags">
                  {report.taste_profile.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <div className="profile-numbers">
                  <div>
                    <strong>{report.metrics.tracks}</strong>
                    <span>首不同歌曲</span>
                  </div>
                  <div>
                    <strong>{report.metrics.artists}</strong>
                    <span>位歌手</span>
                  </div>
                  <div>
                    <strong>{percent(report.metrics.repeat_ratio)}</strong>
                    <span>本期重听</span>
                  </div>
                </div>
                <div className="small-label">反复出现的作品</div>
                <div className="top-tracks">
                  {report.metrics.top_tracks.slice(0, 4).map(({ track, count }) => (
                    <div className="track-row" key={track.id}>
                      <Cover track={track} />
                      <div className="track-info">
                        <strong>{track.name}</strong>
                        <span>{track.artists.map((a) => a.name).join(', ')}</span>
                      </div>
                      <span className="play-count">{count} 次</span>
                      <TrackLink track={track} />
                    </div>
                  ))}
                </div>
              </aside>
            </section>
            {!!report.warnings.length && (
              <details className="data-note">
                <summary>本期数据说明</summary>
                {report.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </details>
            )}
            <section className="metrics-section">
              <div className="section-heading">
                <h2>
                  Taste map <span>听觉侧写</span>
                </h2>
                <span className="muted">基于已收集记录</span>
              </div>
              <div className="metrics-grid">
                <div className="genre-panel">
                  <h3>
                    风格的组成 <span className="pill">AI 分类</span>
                  </h3>
                  <div className="genre-strip" aria-label="风格占比">
                    {report.metrics.genres.map((g, i) => (
                      <span
                        key={g.name}
                        style={{
                          width: (total ? (g.count / total) * 100 : 0) + '%',
                          background: `var(--series-${i % 5})`,
                        }}
                        title={`${g.name} ${g.count} 次`}
                      />
                    ))}
                  </div>
                  <div className="genre-legend">
                    {report.metrics.genres.map((g, i) => (
                      <div key={g.name}>
                        <span
                          className="legend-dot"
                          style={{ background: `var(--series-${i % 5})` }}
                        />
                        <span>{g.name}</span>
                        <strong>{percent(total ? g.count / total : null)}</strong>
                      </div>
                    ))}
                  </div>
                  <details>
                    <summary>这些标签怎么算？</summary>
                    <p>
                      每次播放按歌曲的一个主要风格计入，未知也保留在分母中。标签是音乐知识推测，未经音频分析。
                    </p>
                  </details>
                </div>
                <div className="time-panel">
                  <div className="panel-title">
                    <h3>{metricView === 'hours' ? '音乐出现的时刻' : '唱片的年代'}</h3>
                    <div className="mini-switch">
                      <button
                        aria-pressed={metricView === 'hours'}
                        onClick={() => setMetricView('hours')}
                      >
                        时段
                      </button>
                      <button
                        aria-pressed={metricView === 'decades'}
                        onClick={() => setMetricView('decades')}
                      >
                        年代
                      </button>
                    </div>
                  </div>
                  {metricView === 'hours' ? (
                    <>
                      <div
                        className="hour-chart"
                        role="img"
                        aria-label={
                          '每小时播放记录：' +
                          report.metrics.hours.map((n, i) => `${i}点${n}次`).join('，')
                        }
                      >
                        {report.metrics.hours.map((n, i) => (
                          <div className="hour-column" key={i}>
                            <span className="hour-tooltip">
                              {String(i).padStart(2, '0')}:00 · {n} 次
                            </span>
                            <div
                              style={{
                                height:
                                  Math.max(2, (n / Math.max(1, ...report.metrics.hours)) * 120) +
                                  'px',
                              }}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="hour-axis">
                        <span>00:00</span>
                        <span>06:00</span>
                        <span>12:00</span>
                        <span>18:00</span>
                        <span>23:00</span>
                      </div>
                      <p className="chart-note">{report.timezone} · 播放次数，不代表实际听歌时长</p>
                    </>
                  ) : (
                    <div className="decades">
                      {report.metrics.decades.map((d) => (
                        <div key={d.name}>
                          <span>{d.name}</span>
                          <div>
                            <i style={{ width: percent(total ? d.count / total : 0) }} />
                          </div>
                          <strong>{d.count} 次</strong>
                        </div>
                      ))}
                      <p className="chart-note">按所收录发行版本的年代；重制版不等于原曲年代。</p>
                    </div>
                  )}
                </div>
              </div>
            </section>
            {report.discoveries.length > 0 && (
              <section className="discoveries">
                <div className="section-heading">
                  <h2>
                    Between the tracks <span>选曲之间</span>
                  </h2>
                </div>
                <div className="discovery-grid">
                  {report.discoveries.map((d, i) => (
                    <article key={i}>
                      <h3>{d.title}</h3>
                      <p>{d.body}</p>
                      <div className="linked-tracks">
                        {d.track_ids.map((id) => {
                          const t = findTrack(id);
                          return (
                            t && (
                              <a key={id} href={t.url} target="_blank" rel="noreferrer">
                                {t.name}
                                <ArrowUpRight size={13} />
                              </a>
                            )
                          );
                        })}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {report.fun_facts.length > 0 && (
              <section className="stories">
                {report.fun_facts.map((f, i) => (
                  <article className="story" key={i}>
                    <div className="story-mark">
                      <BookOpen size={30} />
                      <span>Behind the song</span>
                      <span>歌曲还有这一面</span>
                    </div>
                    <div className="story-copy">
                      <h2>{f.title}</h2>
                      <p>{f.body}</p>
                      {f.listen_for && (
                        <p className="listen-for">
                          <Headphones size={16} />
                          {f.listen_for}
                        </p>
                      )}
                      <a href={f.source.url} target="_blank" rel="noreferrer" className="source">
                        来源：{f.source.title}
                        <ArrowUpRight size={14} />
                      </a>
                    </div>
                  </article>
                ))}
              </section>
            )}
            {report.taste_evolution && (
              <section className="evolution">
                <div className="section-heading">
                  <h2>
                    Taste evolution <span>与上期相比</span>
                  </h2>
                </div>
                <h3>{report.taste_evolution.headline}</h3>
                <p>{report.taste_evolution.body}</p>
                {report.previous && (
                  <p className="chart-note">
                    本期 {total} 条 / 上期 {report.previous.plays}{' '}
                    条已收集记录；采集偏差可能影响比较。
                  </p>
                )}
              </section>
            )}
            <section className="recommendations">
              <div className="section-heading">
                <h2>
                  Next on your record shelf <span>接下来听什么</span>
                </h2>
                <span className="muted">从这份 taste 出发</span>
              </div>
              {report.recommendations.length ? (
                <div className="recommendation-grid">
                  {report.recommendations.map((r) => (
                    <article key={r.track.id}>
                      <div className="rec-top">
                        <span>{r.direction}</span>
                        <TrackLink track={r.track} />
                      </div>
                      <div className="rec-track">
                        <Cover track={r.track} large />
                        <div>
                          <h3>{r.track.name}</h3>
                          <p>{r.track.artists.map((a) => a.name).join(', ')}</p>
                        </div>
                      </div>
                      <p className="reason">{r.reason}</p>
                      <span className="connection">
                        从 {findTrack(r.connection_track_id)?.name ?? '本期选曲'} 出发
                      </span>
                      {(status?.owner || demo) && (
                        <div className="feedback">
                          {[
                            ['like', '喜欢'],
                            ['dislike', '不合口味'],
                            ['known', '听过了'],
                          ].map(([value, label]) => (
                            <button
                              key={value}
                              aria-pressed={feedback[r.track.id] === value}
                              onClick={() => void react(r.track, value)}
                            >
                              {value === 'like' ? (
                                <Heart size={14} />
                              ) : value === 'known' ? (
                                <Check size={14} />
                              ) : null}
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted empty-inline">这一期还没有核对成功的推荐歌曲。</p>
              )}
            </section>
            <details className="track-list">
              <summary>查看本期收集的歌曲（{report.metrics.tracks} 首）</summary>
              {report.tracks.map((t) => (
                <div className="track-row" key={t.id}>
                  <Cover track={t} />
                  <div className="track-info">
                    <strong>{t.name}</strong>
                    <span>
                      {t.artists.map((a) => a.name).join(', ')} / {t.album}
                    </span>
                  </div>
                  <TrackLink track={t} />
                </div>
              ))}
            </details>
          </>
        )}
        {!demo && archive.length > 0 && (
          <section className="archive">
            <h2>往期手记</h2>
            <div>
              {archive.slice(0, 12).map((a) => (
                <button
                  key={a.date}
                  disabled={generating}
                  onClick={() => setDate(a.date)}
                  aria-pressed={periodBounds(type, date).start === a.date}
                >
                  <span>{a.date}</span>
                  <strong>{a.title}</strong>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <span>No Taste Today.</span>
        <p>音乐来自 Spotify。记录可能不完整，品味始终在继续。</p>
        <a href="https://open.spotify.com" target="_blank" rel="noreferrer">
          Spotify <ArrowUpRight size={14} />
        </a>
      </footer>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {settings && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettings(false);
          }}
        >
          <dialog
            open
            aria-labelledby="settings-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSettings(false);
            }}
          >
            <div className="modal-heading">
              <h2 id="settings-title">连接与设置</h2>
              <button
                className="icon-button"
                onClick={() => setSettings(false)}
                aria-label="关闭设置"
              >
                <X size={20} />
              </button>
            </div>
            <div className="setting-row">
              <span>当前身份</span>
              <strong>{status?.verified_owner ? '主人已验证' : '普通模式'}</strong>
            </div>
            <p className="muted">
              访客无需连接 Spotify。普通生成仅限当天日报，所有访问者共用 3
              小时间隔；主人验证后可不限间隔重生成日／周／月报告。
            </p>
            {status?.owner && (
              <>
                <div className="setting-row">
                  <span>Spotify</span>
                  <strong>
                    {status.connected
                      ? '已连接'
                      : status.spotify_configured
                        ? '等待授权'
                        : '等待应用配置'}
                  </strong>
                </div>
                <div className="setting-row">
                  <span>Kimi</span>
                  <strong>{status.kimi_configured ? '已配置' : '等待 API Key'}</strong>
                </div>
                <div className="setting-row">
                  <span>Telegram 故障提醒</span>
                  <strong>{status.telegram_configured ? '已配置' : '待配置'}</strong>
                </div>
                <div className="setting-row">
                  <span>报告可见范围</span>
                  <strong>{status.public_reports ? '公开阅读' : '仅主人'}</strong>
                </div>
              </>
            )}
            {status?.verified_owner ? (
              <>
                <a className="primary-button" href="/api/auth/spotify/start">
                  {status.connected ? '重新授权 Spotify' : '连接 Spotify'}
                </a>
                <button
                  className="text-button"
                  onClick={async () => {
                    await api('/api/logout', {});
                    await refreshStatus();
                    void refreshGeneration();
                    setSettings(false);
                  }}
                >
                  退出主人模式
                </button>
              </>
            ) : (
              <>
                {status?.access_configured && (
                  <a className="primary-button" href="/api/admin/login">
                    用邮箱验证主人身份 <ArrowUpRight size={16} />
                  </a>
                )}
                {!status?.access_configured && (
                  <p className="muted">Cloudflare Access 邮箱登录将在正式域名配置后启用。</p>
                )}
                {status?.password_configured && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await api('/api/login', { password });
                        setPassword('');
                        await refreshStatus();
                        setSettings(false);
                      } catch (e) {
                        setNotice((e as Error).message);
                      }
                    }}
                  >
                    <label>
                      备用管理口令
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </label>
                    <button className="primary-button">登录</button>
                  </form>
                )}
              </>
            )}
          </dialog>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
