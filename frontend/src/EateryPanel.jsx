import { useEffect, useState } from 'react';
import { api, loginUrl } from './api.js';
import { fmtTime } from './geo.js';

const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

export default function EateryPanel({ id, user, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const load = () => api(`/api/eateries/${id}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); setErr(''); load(); }, [id]);
  const submit = async () => {
    setErr('');
    try { await api(`/api/eateries/${id}/reviews`, { method: 'POST', body: JSON.stringify({ rating, content }) }); setContent(''); load(); }
    catch (e) { setErr(e.message); }
  };
  const remove = async (rid) => { if (confirm('確定刪除?')) { await api(`/api/eateries/reviews/${rid}`, { method: 'DELETE' }); load(); } };
  return (
    <aside className="panel">
      <button className="close" onClick={onClose}>✕</button>
      {!data && !err && <p>載入中…</p>}
      {data && (
        <>
          <h2>{data.name}</h2>
          <div className="tags"><span>{data.category}</span>{data.priceRange != null && <span>約 ${data.priceRange}/人</span>}</div>
          {data.address && <p className="muted">{data.address}</p>}
          {data.description && <p>{data.description}</p>}
          <h3>學生評價 {data.avgRating && <small>{stars(data.avgRating)} {data.avgRating} ({data.reviewCount})</small>}</h3>
          {data.reviews.length === 0 && <p className="muted">還沒有評價</p>}
          {data.reviews.map((r) => (
            <div className="review" key={r.id}>
              <div>{stars(r.rating)} <small className="muted">{fmtTime(r.createdAt)}</small></div>
              <p>{r.content}</p>
              {r.isMine && <button className="link" onClick={() => remove(r.id)}>刪除我的評價</button>}
            </div>
          ))}
          {user ? (
            <div className="form">
              <h4>寫評價(匿名顯示)</h4>
              <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} 星</option>)}</select>
              <textarea rows="3" placeholder="口味、份量、排隊、CP 值…" value={content} onChange={(e) => setContent(e.target.value)} />
              <button onClick={submit}>送出評價</button>
            </div>
          ) : <p><a href={loginUrl}>使用中大信箱登入</a>後即可評價</p>}
        </>
      )}
      {err && <p className="error">{err}</p>}
    </aside>
  );
}
