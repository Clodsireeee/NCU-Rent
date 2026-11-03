import { useEffect, useState } from 'react';
import { api, loginUrl } from './api.js';
import { Commute, Checklist } from './Extras.jsx';
import { TYPE_LABEL, fmtTime, isOld } from './geo.js';

const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

export default function DetailPanel({ id, user, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');

  const load = () =>
    api(`/api/properties/${id}`).then(setData).catch((e) => setErr(e.message));

  useEffect(() => { setData(null); setErr(''); load(); }, [id]);

  const submit = async () => {
    setErr('');
    try {
      await api(`/api/properties/${id}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ rating, content }),
      });
      setContent('');
      load();
    } catch (e) { setErr(e.message); }
  };

  const remove = async (rid) => {
    if (!confirm('確定刪除這則評價?')) return;
    await api(`/api/reviews/${rid}`, { method: 'DELETE' });
    load();
  };

  return (
    <aside className="panel">
      <button className="close" onClick={onClose}>✕</button>
      {!data && !err && <p>載入中…</p>}
      {data && (
        <>
          {data.images.length > 0 && (
            <div className="gallery">
              {data.images.map((i) => <img key={i.id} src={i.url} alt={data.title} />)}
            </div>
          )}
          <h2>{data.title}</h2>
          <p className="price">NT$ {data.price.toLocaleString()} / 月</p>
          <p className="muted">{data.address}</p>
          <div className="tags">
            {data.listingType !== 'RENT' && <span className="warn">{TYPE_LABEL[data.listingType]}{data.availableFrom && ` ${data.availableFrom.slice(0, 10)}`}{data.availableTo && ` ~ ${data.availableTo.slice(0, 10)}`}</span>}
            {data.rentSubsidy && <span>可申請租補</span>}
            {data.hasTrashService && <span>垃圾代收</span>}
            {data.hasIndoorParking && <span>室內機車位</span>}
          </div>
          {data.description && <p>{data.description}</p>}
          <Commute p={data} />
          <Checklist id={id} />

          <h3>
            學生評價{' '}
            {data.avgRating && <small>{stars(data.avgRating)} {data.avgRating} ({data.reviewCount})</small>}
          </h3>
          {data.reviews.length === 0 && <p className="muted">還沒有評價</p>}
          {data.reviews.map((r) => (
            <div className="review" key={r.id}>
              <div>{stars(r.rating)} <small className="muted">{fmtTime(r.createdAt)}{isOld(r.createdAt) && ' · 超過兩年,僅供參考'}</small></div>
              <p>{r.content}</p>
              {r.isMine && <button className="link" onClick={() => remove(r.id)}>刪除我的評價</button>}
            </div>
          ))}

          {user ? (
            <div className="form">
              <h4>寫評價(匿名顯示)</h4>
              <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} 星</option>)}
              </select>
              <textarea rows="4" placeholder="隔音、房東態度、蟲害…(至少 10 字)" value={content} onChange={(e) => setContent(e.target.value)} />
              <button onClick={submit}>送出評價</button>
            </div>
          ) : (
            <p><a href={loginUrl}>使用中大信箱登入</a>後即可評價</p>
          )}
        </>
      )}
      {err && <p className="error">{err}</p>}
    </aside>
  );
}
