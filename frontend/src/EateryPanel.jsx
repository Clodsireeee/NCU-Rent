import { useEffect, useState } from 'react';
import { api } from './api.js';
import Reviews from './Reviews.jsx';

export default function EateryPanel({ id, user, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api(`/api/eateries/${id}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); setErr(''); load(); }, [id]);
  const g = data?.google;

  return (
    <aside className="panel">
      <button className="close" onClick={onClose}>✕</button>
      {!data && !err && <p>載入中…</p>}
      {data && (
        <>
          <h2>{data.name || '(暫時無法取得店名)'}</h2>
          <div className="tags">
            <span>{data.category}</span>
            {data.priceRange != null && <span>約 ${data.priceRange}/人</span>}
            {g?.priceLevel && <span>{g.priceLevel}</span>}
            {g?.openNow === true && <span>營業中</span>}
            {g?.openNow === false && <span className="full">休息中</span>}
          </div>
          {data.address && <p className="muted">{data.address}</p>}
          {data.description && <p>{data.description}</p>}

          {g && (
            <div className="box google">
              {g.rating != null && <div>Google 評分 <b>{g.rating}</b> ★({g.ratingCount} 則)</div>}
              {g.phone && <div>電話:{g.phone}</div>}
              {g.hours.length > 0 && (
                <details><summary>營業時間</summary>{g.hours.map((h) => <div key={h}>{h}</div>)}</details>
              )}
              {g.mapsUri && <div><a href={g.mapsUri} target="_blank" rel="noreferrer">在 Google 地圖查看評論與路線 ↗</a></div>}
              {/* Google 條款:顯示 Places 資料但未搭配 Google 地圖時,必須標示來源 */}
              <div className="gmaps-attr" translate="no" aria-label="Google Maps">Google Maps</div>
            </div>
          )}
          {data.source === 'GOOGLE' && !g && <p className="muted">暫時無法取得 Google 店家資訊。</p>}

          <Reviews
            reviews={data.reviews}
            avgRating={data.avgRating}
            reviewCount={data.reviewCount}
            user={user}
            reload={load}
            postUrl={`/api/eateries/${id}/reviews`}
            deleteUrl={(rid) => `/api/eateries/reviews/${rid}`}
            reportUrl={(rid) => `/api/eateries/reviews/${rid}/report`}
            minLength={5}
            placeholder="口味、份量、排隊、CP 值…"
          />
        </>
      )}
      {err && <p className="error">{err}</p>}
    </aside>
  );
}
