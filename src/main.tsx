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
  Share2,
} from 'lucide-react';
import { addDays, localDate, periodBounds } from '../shared/metrics';
import { demoReport } from '../shared/demo';
import type { PeriodType, Report, Track } from '../shared/schema';
import './styles.css';
import { ShareDialog } from './ShareDialog';
import { sideReport } from '../shared/sides';
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
    [storedReport, setReport] = useState<Report | null>(null),
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
  const [side, setSide] = useState<'a' | 'b'>('a');
  const [flipping, setFlipping] = useState(false);
  const flipTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const report = storedReport ? sideReport(storedReport, side) : null;
  useEffect(() => {
    setSide('a');
    setFlipping(false);
    return () => {
      flipTimers.current.forEach(clearTimeout);
      flipTimers.current = [];
    };
  }, [type, date, demo]);
  function flip(next: 'a' | 'b') {
    if (next === side || flipping) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSide(next);
      return;
    }
    setFlipping(true);
    flipTimers.current = [
      setTimeout(() => setSide(next), 280),
      setTimeout(() => setFlipping(false), 560),
    ];
  }
  const [shareReport, setShareReport] = useState<Report | null>(null);
  const [revision, setRevision] = useState(0);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [checkingModel, setCheckingModel] = useState(false);
  const [modelCheck, setModelCheck] = useState('');
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
    const resume = () => {
      if (!document.hidden) void refreshGeneration();
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, [status, revision]);
  useEffect(() => {
    if (generation?.running) {
      const timer = setInterval(() => {
        if (!document.hidden) void refreshGeneration();
      }, 10000);
      return () => clearInterval(timer);
    }
    if (generation?.next_allowed_at) {
      const remaining = Date.parse(generation.next_allowed_at) - Date.now();
      const timer = setTimeout(() => void refreshGeneration(), Math.max(1000, remaining + 1000));
      return () => clearTimeout(timer);
    }
  }, [generation?.running, generation?.next_allowed_at]);
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
    if (!['queued', 'running'].includes(collection?.job?.status ?? '') || demo) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      void api<NonNullable<typeof collection>>('/api/collection?type=' + type + '&date=' + date)
        .then((sample) => {
          setCollection(sample);
          if (!['queued', 'running'].includes(sample.job?.status ?? '')) setRevision((v) => v + 1);
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
    setStage('提交任务');
    try {
      const job = await api<{ status: string; error?: string }>('/api/generate', { type, date });
      if (job.status === 'failed') throw new Error(job.error ?? '生成失败');
      setDemo(false);
      setRevision((v) => v + 1);
      setNotice('已提交，可关闭页面');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage('');
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
        setNotice('已记下');
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
  const currentTracks = [...(storedReport?.tracks ?? []), ...(storedReport?.b_side?.tracks ?? [])];
  const findTrack = (id: string) => currentTracks.find((t) => t.id === id);
  const total = report?.metrics.plays ?? 0;
  const hasComment = !!report?.taste_comment.paragraphs.length;
  const missingComment = !!report && total > 0 && !hasComment;
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
    <div className={'journal-shell side-' + side}>
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
            {report && !loading && (
              <button onClick={() => setShareReport(storedReport)} aria-label="分享这一期">
                <Share2 size={16} />
                分享
              </button>
            )}
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
        {demo && (
          <div className="sample-banner">
            <span>示例刊</span>虚构听歌记录
          </div>
        )}
        {(generating ||
          generation?.running ||
          ['queued', 'running'].includes(collection?.job?.status ?? '')) && (
          <div className="progress-note" role="status">
            <AudioLines size={20} />
            {stage || generation?.stage || collection?.job?.stage}
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setRevision((v) => v + 1)}>重新加载</button>
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
            <h1>这一期还未发布</h1>
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
                {side === 'b' && !storedReport?.b_side ? (
                  'B 面尚未生成'
                ) : (
                  <>
                    {side === 'b' ? '记录到' : '收录'} {total} 次{side === 'b' ? '跳过' : '播放'} ·{' '}
                    {report.metrics.observed_days} 天有记录
                  </>
                )}
              </span>
            </div>
            <div className="record-switch" role="group" aria-label="唱片双面">
              <button aria-pressed={side === 'a'} disabled={flipping} onClick={() => flip('a')}>
                <b>A 面</b>
                <span>Taste today.</span>
              </button>
              <div className={'record-disc ' + (flipping ? 'is-turning' : '')} aria-hidden="true">
                <i />
                <em>{side.toUpperCase()}</em>
              </div>
              <button aria-pressed={side === 'b'} disabled={flipping} onClick={() => flip('b')}>
                <b>B 面</b>
                <span>Not today.</span>
              </button>
            </div>
            <div
              className={
                'record-body ' +
                (flipping ? 'is-flipping ' : '') +
                (side === 'b' && !total ? 'is-empty-side' : '')
              }
            >
              <section className="opening">
                <article className="review">
                  <div className="section-caption">
                    <span>{side === 'b' ? 'Not today.' : 'Taste comment'}</span>
                    <span>{side === 'b' ? '这一期，擦肩而过' : '关于这一期的选择'}</span>
                  </div>
                  <h1>
                    {missingComment
                      ? side === 'b'
                        ? 'B 面短评未生成'
                        : '乐评未生成'
                      : report.taste_comment.title}
                  </h1>
                  <p className="standfirst">
                    {missingComment
                      ? side === 'b'
                        ? '跳过记录已保存。'
                        : '播放记录已保存。'
                      : report.taste_comment.standfirst}
                  </p>
                  {missingComment && status?.owner && (
                    <button className="text-button" onClick={() => setSettings(true)}>
                      查看原因
                    </button>
                  )}
                  <div className="review-copy">
                    {report.taste_comment.paragraphs.map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                  </div>
                  {hasComment && (
                    <div className="review-foot">
                      <span>{report.demo ? '示例乐评' : 'AI 乐评'}</span>
                    </div>
                  )}
                </article>
                <aside className="profile">
                  <div className="profile-top">
                    <AudioLines size={25} />
                    <span>{side === 'b' ? '略过的声音' : '这一期的声音'}</span>
                  </div>
                  <h2>{missingComment ? '本期选曲' : report.taste_profile.headline}</h2>
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
                      <span>{side === 'b' ? '重复跳过占比' : '本期重听'}</span>
                    </div>
                  </div>
                  <div className="small-label">
                    {side === 'b' ? '擦肩而过的作品' : '反复出现的作品'}
                  </div>
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
              <section className="metrics-section">
                <div className="section-heading">
                  <h2>
                    {side === 'b' ? 'The other side' : 'Taste map'}{' '}
                    <span>{side === 'b' ? '品味的另一面' : '听觉侧写'}</span>
                  </h2>
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
                  </div>
                  <div className="time-panel">
                    <div className="panel-title">
                      <h3>
                        {metricView === 'hours'
                          ? side === 'b'
                            ? '跳过发生的时刻'
                            : '音乐出现的时刻'
                          : '唱片的年代'}
                      </h3>
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
                            (side === 'b' ? '每小时跳过记录：' : '每小时播放记录：') +
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
                        <p className="chart-note">
                          {report.timezone} · {side === 'b' ? '跳过次数' : '播放次数'}
                        </p>
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
                        <p className="chart-note">按发行版本计</p>
                      </div>
                    )}
                  </div>
                </div>
              </section>
              {report.discoveries.length > 0 && (
                <section className="discoveries">
                  <div className="section-heading">
                    <h2>
                      {side === 'b' ? 'Between the sides' : 'Between the tracks'}{' '}
                      <span>{side === 'b' ? '取舍之间' : '选曲之间'}</span>
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
                      本期 {total} 条 / 上期 {report.previous.plays} 条记录
                    </p>
                  )}
                </section>
              )}
              {report.recommendations.length > 0 && (
                <section className="recommendations">
                  <div className="section-heading">
                    <h2>
                      Next on your record shelf <span>接下来听什么</span>
                    </h2>
                  </div>
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
                </section>
              )}
              <details className="track-list">
                <summary>
                  {side === 'b' ? '略过的歌单' : '本期歌单'} · {report.metrics.tracks} 首
                </summary>
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
              <details className="data-note">
                <summary>关于本期</summary>
                <p>来自 Spotify 最近播放，可能不含本期全部记录。统计按播放次数计算。</p>
                {storedReport?.skip_rule && (
                  <p>
                    按相邻记录间隔大于 0、不超过 10
                    秒，将前一条记为跳过。无后续记录或时间顺序不明时不判定。A 面不表示完整听完，B
                    面不代表不喜欢；同一歌曲的不同记录可以出现在两面。
                  </p>
                )}
                <p>风格标签由 AI 推测，未经音频分析；年代以所收录的发行版本为准。</p>
                {hasComment && <p>乐评模型：{report.model}</p>}
              </details>
            </div>
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
        <a href="https://open.spotify.com" target="_blank" rel="noreferrer">
          Spotify <ArrowUpRight size={14} />
        </a>
      </footer>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {shareReport && (
        <ShareDialog
          report={shareReport}
          publicLink={!!status?.public_reports && !status.local && !shareReport.demo}
          onClose={() => setShareReport(null)}
        />
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
              <strong>{status?.verified_owner ? '管理员' : '访客'}</strong>
            </div>
            <details className="data-note">
              <summary>生成规则</summary>
              <p>访客仅可生成当天日报，共享 3 小时冷却。管理员可随时重生成历史日／周／月报告。</p>
            </details>
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
                {status.verified_owner && (
                  <>
                    <button
                      className="text-button"
                      disabled={checkingModel}
                      onClick={async () => {
                        setCheckingModel(true);
                        setModelCheck('');
                        try {
                          await api('/api/admin/model-check', {});
                          setModelCheck('Kimi 连接正常');
                        } catch (e) {
                          setModelCheck((e as Error).message);
                        } finally {
                          setCheckingModel(false);
                        }
                      }}
                    >
                      {checkingModel ? '正在检测…' : '检测 Kimi 连接'}
                    </button>
                    {modelCheck && (
                      <p className="muted" role="status">
                        {modelCheck}
                      </p>
                    )}
                  </>
                )}
                <div className="setting-row">
                  <span>Telegram 故障提醒</span>
                  <strong>{status.telegram_configured ? '已配置' : '待配置'}</strong>
                </div>
                <div className="setting-row">
                  <span>报告可见范围</span>
                  <strong>{status.public_reports ? '公开阅读' : '仅主人'}</strong>
                </div>
                {collection && (
                  <div className="setting-row">
                    <span>本期播放记录</span>
                    <strong>{collection.plays} 次</strong>
                  </div>
                )}
                {(!!report?.warnings.length || collection?.job?.error) && (
                  <details className="data-note" open={missingComment}>
                    <summary>生成详情</summary>
                    {report?.warnings.map((warning, i) => (
                      <p key={i}>{warning}</p>
                    ))}
                    {collection?.job?.error && <p>{collection.job.error}</p>}
                  </details>
                )}
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
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
