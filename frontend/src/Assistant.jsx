// AI 助理分頁:租屋代理人(會自己查資料的 AI)+ 新生入學包
import { useEffect, useRef, useState } from 'react';
import { api, loginUrl } from './api.js';
import './ai.css';

const TOOL_LABEL = {
  search_properties: '搜尋房源', get_property: '查看房源', estimate_commute: '估算通勤',
  search_campus_news: '搜尋校園消息', get_campus_news: '閱讀公告', list_news_tags: '查看標籤', search_clubs: '搜尋社團',
};
const EXAMPLES = [
  '我預算 7000,想住離中大後門走路 10 分鐘內、可以租補的套房,推薦三間',
  '我週末要在中壢火車站打工,哪幾間房源通勤比較方便?',
  '比較評價最好的三間房源,各自的缺點是什麼?',
  '這兩週有什麼社團活動或講座?',
];

/** 把回覆中的 [房源#12] 變成可以點的按鈕 */
function RichText({ text, onOpenProperty }) {
  const parts = text.split(/(\[房源#\d+\]|https?:\/\/[^\s)）]+)/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[房源#(\d+)\]$/);
    if (m) return <button key={i} className="prop-chip" onClick={() => onOpenProperty(Number(m[1]))}>🏠 房源 #{m[1]}</button>;
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer">{p.length > 50 ? `${p.slice(0, 50)}…` : p}</a>;
    return <span key={i}>{p}</span>;
  });
}

function Agent({ user, onOpenProperty }) {
  const [msgs, setMsgs] = useState([]); // { role, content, steps? }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const next = [...msgs, { role: 'user', content: q }];
    setMsgs(next); setInput(''); setErr(''); setBusy(true);
    try {
      const r = await api('/api/ai/agent', {
        method: 'POST',
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      setMsgs([...next, { role: 'assistant', content: r.reply, steps: r.steps }]);
    } catch (e) {
      setErr(e.message);
      setMsgs(msgs); // 失敗就還原,讓使用者可以再送一次
      setInput(q);
    } finally { setBusy(false); }
  };

  return (
    <div className="agent">
      <div className="chat">
        {msgs.length === 0 && (
          <div className="chat-empty">
            <p>我是 <b>NCU-Rent 租屋代理人</b>。告訴我你的預算、常去的地方、在意的條件,我會自己去查房源、看學長姐評論、算通勤時間,再整理推薦給你。</p>
            <div className="examples">
              {EXAMPLES.map((e) => <button key={e} onClick={() => send(e)}>{e}</button>)}
            </div>
            {!user && <p className="muted small">未登入每小時可問 5 次,<a href={loginUrl}>登入</a>後可以問更多。</p>}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.steps?.length > 0 && (
              <details className="steps">
                <summary>🔧 AI 做了 {m.steps.length} 個步驟</summary>
                {m.steps.map((s, j) => (
                  <div key={j} className={s.ok ? '' : 'step-fail'}>
                    {s.ok ? '✓' : '✗'} {TOOL_LABEL[s.tool] || s.tool}:{s.summary}
                  </div>
                ))}
              </details>
            )}
            <div className="bubble-text">
              {m.role === 'assistant' ? <RichText text={m.content} onOpenProperty={onOpenProperty} /> : m.content}
            </div>
          </div>
        ))}
        {busy && <div className="bubble assistant thinking">🔍 查資料中,約需 10~30 秒…</div>}
        <div ref={endRef} />
      </div>
      {err && <p className="error">{err}</p>}
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          rows="2"
          placeholder="例如:預算 8000、想住近後門、要有室內機車位…(Enter 送出,Shift+Enter 換行)"
          value={input}
          maxLength={1000}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        />
        <div className="chat-actions">
          <button type="submit" disabled={busy || !input.trim()}>送出</button>
          {msgs.length > 0 && <button type="button" className="link" onClick={() => { setMsgs([]); setErr(''); }}>重新開始</button>}
        </div>
      </form>
      <p className="muted small">AI 只根據 NCU-Rent 的資料回答,通勤時間為概估;租約與法律問題請向學校賃居服務確認。</p>
    </div>
  );
}

const IDENTITIES = ['新生', '轉學生', '研究生', '國際生', '交換生'];
const HOUSING = ['宿舍', '校外租屋', '通勤', '還沒決定'];

function Freshman() {
  const [identity, setIdentity] = useState('新生');
  const [housing, setHousing] = useState('還沒決定');
  const [interests, setInterests] = useState('');
  const [lang, setLang] = useState('zh');
  const [guide, setGuide] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const generate = async () => {
    setBusy(true); setErr(''); setGuide(null);
    try {
      const list = interests.split(/[,,、\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 5);
      setGuide(await api('/api/ai/freshman', { method: 'POST', body: JSON.stringify({ identity, housing, interests: list, lang }) }));
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const Src = ({ item }) => (item.url ? <a className="src" href={item.url} target="_blank" rel="noreferrer" title={item.source}>來源 ↗</a> : null);

  return (
    <div className="freshman">
      <div className="fm-form">
        <label>我是
          <select value={identity} onChange={(e) => setIdentity(e.target.value)}>{IDENTITIES.map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        <label>住宿打算
          <select value={housing} onChange={(e) => setHousing(e.target.value)}>{HOUSING.map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        <label>興趣(最多 5 個)
          <input value={interests} onChange={(e) => setInterests(e.target.value)} placeholder="例如:吉他、登山、程式" />
        </label>
        <label>語言
          <select value={lang} onChange={(e) => setLang(e.target.value)}><option value="zh">中文</option><option value="en">English</option></select>
        </label>
        <button onClick={generate} disabled={busy}>{busy ? '整理中,約 20 秒…' : '✨ 產生我的入學包'}</button>
      </div>
      {err && <p className="error">{err}</p>}

      {guide && (
        <div className="fm-result">
          {guide.intro && <p className="fm-intro">{guide.intro}</p>}
          {guide.timeline.length > 0 && (
            <section>
              <h3>📅 重要時程</h3>
              <ol className="fm-timeline">
                {guide.timeline.map((t, i) => (
                  <li key={i}><span className="fm-date">{t.date}</span><b>{t.title}</b> {t.detail} <Src item={t} /></li>
                ))}
              </ol>
            </section>
          )}
          {guide.checklist.length > 0 && (
            <section>
              <h3>✅ 待辦清單</h3>
              <ul className="fm-check">{guide.checklist.map((c, i) => <li key={i}><b>{c.item}</b> {c.detail} <Src item={c} /></li>)}</ul>
            </section>
          )}
          {guide.housing.length > 0 && (
            <section>
              <h3>🏠 住宿建議</h3>
              <ul>{guide.housing.map((h, i) => <li key={i}>{h.tip} <Src item={h} /></li>)}</ul>
            </section>
          )}
          {guide.clubs.length > 0 && (
            <section>
              <h3>🎪 你可能會喜歡的社團</h3>
              <ul>{guide.clubs.map((c) => (
                <li key={c.name}><a href={c.url} target="_blank" rel="noreferrer"><b>{c.name}</b></a>:{c.why}
                  {c.links.map((l) => <a key={l} className="src" href={l} target="_blank" rel="noreferrer">{/instagram/.test(l) ? 'IG' : 'FB'}</a>)}
                </li>
              ))}</ul>
            </section>
          )}
          {guide.notes && <p className="fm-notes">⚠️ {guide.notes}</p>}
          <p className="muted small">
            由 AI 依據 {guide.basedOn?.posts} 則學校公告與 {guide.basedOn?.clubs} 個社團整理,日期皆附來源;
            最終以學校公告為準。{guide.cached && '(此為 6 小時內的快取結果)'}
          </p>
        </div>
      )}
    </div>
  );
}

export default function Assistant({ user, onOpenProperty }) {
  const [view, setView] = useState('agent');
  const [status, setStatus] = useState(null);
  useEffect(() => { api('/api/ai/status').then(setStatus).catch(() => setStatus({ enabled: false })); }, []);

  return (
    <section className="campus-page ai-page">
      <nav className="subtabs">
        <button className={view === 'agent' ? 'on' : ''} onClick={() => setView('agent')}>🤖 租屋代理人</button>
        <button className={view === 'freshman' ? 'on' : ''} onClick={() => setView('freshman')}>🎓 新生入學包</button>
      </nav>
      {status && !status.enabled && <p className="notice">AI 功能尚未啟用:伺服器需要設定 AI_API_KEY。</p>}
      {view === 'agent' ? <Agent user={user} onOpenProperty={onOpenProperty} /> : <Freshman />}
    </section>
  );
}
