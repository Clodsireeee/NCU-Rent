// 校園最新資訊:AI 標籤篩選 + 社團名錄
import { useEffect, useState } from 'react';
import { api } from './api.js';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : '');
const fmtEvent = (s, e) => {
  if (!s) return null;
  const opt = { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
  const start = new Date(s).toLocaleString('zh-TW', opt).replace(' 00:00', '');
  return e ? `${start} ~ ${new Date(e).toLocaleString('zh-TW', opt).replace(' 00:00', '')}` : start;
};
const KEY = 'campus:tags';

// 把文字中的網址變成可以點的連結
function Linkify({ text }) {
  const parts = text.split(/(https?:\/\/[^\s，。、)）]+)/g);
  return parts.map((p, i) => (/^https?:\/\//.test(p)
    ? <a key={i} href={p} target="_blank" rel="noreferrer">{p.length > 60 ? `${p.slice(0, 60)}…` : p}</a>
    : <span key={i}>{p}</span>));
}

// 展開後顯示的原始公告內文與附件
function FullText({ id }) {
  const [post, setPost] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/api/campus/posts/${id}`).then(setPost).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <p className="error">{err}</p>;
  if (!post) return <p className="muted">載入中…</p>;
  return (
    <div className="post-full">
      {post.content
        ? <div className="post-content"><Linkify text={post.content} /></div>
        : <p className="muted">這則公告沒有抓到文字內容,可能只有圖片或附件,請看原公告。</p>}
      {post.attachments.length > 0 && (
        <div className="post-attachments">
          <b>📎 附件</b>
          {post.attachments.map((a) => <a key={a.url} href={a.url} target="_blank" rel="noreferrer">{a.name}</a>)}
        </div>
      )}
      <a className="post-source" href={post.url} target="_blank" rel="noreferrer">查看原公告網頁 ↗</a>
    </div>
  );
}

function Posts() {
  const [tags, setTags] = useState([]);
  const [sources, setSources] = useState([]);
  const [sel, setSel] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } });
  const [match, setMatch] = useState('any');
  const [upcoming, setUpcoming] = useState(false);
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState({ items: [], total: 0, page: 0, pages: 0 });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(() => new Set()); // 展開全文的公告 id
  const toggleOpen = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  useEffect(() => {
    api('/api/campus/tags').then(setTags).catch(() => {});
    api('/api/campus/sources').then(setSources).catch(() => {});
  }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(sel)); } catch {} }, [sel]);

  const load = async (page = 1) => {
    setLoading(true); setErr('');
    const p = new URLSearchParams({ page, match });
    if (sel.length) p.set('tags', sel.join(','));
    if (upcoming) p.set('upcoming', 'true');
    if (source) p.set('source', source);
    if (query) p.set('q', query);
    try {
      const r = await api(`/api/campus/posts?${p}`);
      setData((d) => (page === 1 ? r : { ...r, items: [...d.items, ...r.items] }));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(1); }, [sel, match, upcoming, source, query]);

  const toggle = (t) => setSel((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const emoji = Object.fromEntries(tags.map((t) => [t.tag, t.emoji]));

  return (
    <>
      <div className="chips">
        {tags.map((t) => (
          <button key={t.tag} className={`chip ${sel.includes(t.tag) ? 'on' : ''}`} onClick={() => toggle(t.tag)} disabled={!t.count && !sel.includes(t.tag)}>
            {t.emoji} {t.tag} <small>{t.count}</small>
          </button>
        ))}
        {sel.length > 0 && <button className="link" onClick={() => setSel([])}>清除</button>}
      </div>
      <div className="campus-bar">
        {sel.length > 1 && (
          <select value={match} onChange={(e) => setMatch(e.target.value)}>
            <option value="any">符合任一標籤</option>
            <option value="all">符合全部標籤</option>
          </select>
        )}
        <label><input type="checkbox" checked={upcoming} onChange={() => setUpcoming(!upcoming)} />只看即將舉辦的活動</label>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">全部來源</option>
          {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <input placeholder="搜尋標題、單位、社團" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <small className="muted">共 {data.total} 則</small>
      </div>

      {err && <p className="error">{err}</p>}
      <div className="posts">
        {data.items.map((p) => (
          <article key={p.id} className="post">
            <div className="post-meta">
              <span>{fmtDate(p.publishedAt)}</span>
              {p.publisher && <span>{p.publisher}</span>}
              {p.rawCategory && <span className="muted">{p.rawCategory}</span>}
            </div>
            <a className="post-title" href={p.url} target="_blank" rel="noreferrer">{p.title}</a>
            {p.summary
              ? <p className="post-summary">🤖 {p.summary}</p>
              : p.excerpt && !open.has(p.id) && <p className="post-summary excerpt">{p.excerpt}</p>}
            {(p.eventStart || p.location || p.clubName) && (
              <div className="post-event">
                {p.eventStart && <span>🗓 {fmtEvent(p.eventStart, p.eventEnd)}</span>}
                {p.location && <span>📍 {p.location}</span>}
                {p.clubName && <span>🎪 {p.clubName}</span>}
              </div>
            )}
            <div className="post-tags">
              {p.tags.map((t) => (
                <button key={t} className={`chip small ${sel.includes(t) ? 'on' : ''}`} onClick={() => toggle(t)}>{emoji[t]} {t}</button>
              ))}
              {p.taggedBy?.startsWith('ai') && <small className="muted" title={p.taggedBy}>AI 標籤</small>}
            </div>
            <div className="post-actions">
              <button className="link" onClick={() => toggleOpen(p.id)}>
                {open.has(p.id) ? '收合 ▴' : `展開全文${p.attachmentCount ? `(附件 ${p.attachmentCount})` : ''} ▾`}
              </button>
              <a href={p.url} target="_blank" rel="noreferrer">原公告 ↗</a>
            </div>
            {open.has(p.id) && <FullText id={p.id} />}
          </article>
        ))}
        {!loading && data.items.length === 0 && <p className="muted">沒有符合條件的消息。{upcoming && '(活動時間由 AI 從公告內文擷取,未設定 AI 時沒有這項資料)'}</p>}
      </div>
      {data.page < data.pages && <button className="more" disabled={loading} onClick={() => load(data.page + 1)}>{loading ? '載入中…' : '載入更多'}</button>}
    </>
  );
}

function Clubs() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [nature, setNature] = useState('');
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (nature) p.set('nature', nature);
    const t = setTimeout(() => api(`/api/campus/clubs?${p}`).then(setList).catch(() => setList([])), 250);
    return () => clearTimeout(t);
  }, [q, nature]);
  const natures = [...new Set(list.map((c) => c.nature).filter(Boolean))];
  return (
    <>
      <div className="campus-bar">
        <input placeholder="搜尋社團名稱或介紹" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={nature} onChange={(e) => setNature(e.target.value)}>
          <option value="">全部性質</option>
          {(nature ? [nature, ...natures.filter((n) => n !== nature)] : natures).map((n) => <option key={n}>{n}</option>)}
        </select>
        <small className="muted">{list.length} 個社團 · 資料來源:課外活動組社團總覽</small>
      </div>
      <div className="clubs">
        {list.map((c) => (
          <article key={c.id} className="club">
            <h4><a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> {c.nature && <small className="tag">{c.nature}</small>}</h4>
            {c.intro && <p>{c.intro.slice(0, 120)}{c.intro.length > 120 && '…'}</p>}
            <div className="club-links">
              {c.links.map((l) => <a key={l} href={l} target="_blank" rel="noreferrer">{/instagram/.test(l) ? 'IG' : /facebook|fb\.com/.test(l) ? 'FB' : '連結'}</a>)}
            </div>
            {c.latestPost && <small className="muted">最新:<a href={c.latestPost.url} target="_blank" rel="noreferrer">{c.latestPost.title}</a></small>}
          </article>
        ))}
      </div>
    </>
  );
}

export default function Campus() {
  const [view, setView] = useState('posts');
  return (
    <section className="campus-page">
      <nav className="subtabs">
        <button className={view === 'posts' ? 'on' : ''} onClick={() => setView('posts')}>📰 最新消息</button>
        <button className={view === 'clubs' ? 'on' : ''} onClick={() => setView('clubs')}>🎪 社團名錄</button>
      </nav>
      {view === 'posts' ? <Posts /> : <Clubs />}
    </section>
  );
}
