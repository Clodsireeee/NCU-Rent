import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Commute, Checklist } from './Extras.jsx';
import Reviews from './Reviews.jsx';
import { TYPE_LABEL, SOURCE_LABEL, fmtPrice } from './geo.js';

export default function DetailPanel({ id, user, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = () => api(`/api/properties/${id}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { setData(null); setErr(''); load(); }, [id]);

  return (
    <aside className="panel">
      <button className="close" onClick={onClose}>✕</button>
      {!data && !err && <p>載入中…</p>}
      {data && (
        <>
          {data.images.length > 0 ? (
            <div className="gallery">
              {data.images.map((i) => <img key={i.id} src={i.url} alt={data.title} />)}
            </div>
          ) : data.extra?.imageUrl && (
            // 雲端租屋網上的房源照片(直接連到原網站,不另外儲存)
            <div className="gallery">
              <img src={data.extra.imageUrl} alt={data.title} referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            </div>
          )}
          <h2>{data.title}</h2>
          <p className="price">{data.price != null ? `NT$ ${fmtPrice(data)} / 月` : '租金請向房東洽詢'}</p>
          <p className="muted">{data.address}</p>
          <div className="tags">
            {data.fireSafetyCertified && <span className="safe">🧯 學校消防合格</span>}
            {data.vacancy === 0 && <span className="full">目前滿租</span>}
            {data.vacancy > 0 && <span>空房 {data.vacancy} 間{data.extra?.totalRooms ? ` / 共 ${data.extra.totalRooms} 間` : ''}</span>}
            {data.extra?.rentType && <span>{data.extra.rentType}</span>}
            {data.extra?.gender && data.extra.gender !== '無限制' && <span className="warn">限{data.extra.gender}</span>}
            {data.listingType !== 'RENT' && <span className="warn">{TYPE_LABEL[data.listingType]}{data.availableFrom && ` ${data.availableFrom.slice(0, 10)}`}{data.availableTo && ` ~ ${data.availableTo.slice(0, 10)}`}</span>}
            {data.rentSubsidy && <span>可申請租補</span>}
            {data.hasTrashService && <span>垃圾代收</span>}
            {data.hasIndoorParking && <span>室內機車位</span>}
          </div>
          {data.source !== 'USER' && (
            <div className="box source">
              資料來源:{SOURCE_LABEL[data.source]}
              {data.extra?.school && data.source === 'NEARBY_SCHOOL' && `(${data.extra.school})`}
              {data.lastSyncedAt && <small className="muted"> · 同步於 {data.lastSyncedAt.slice(0, 10)}</small>}
              {data.sourceUrl && <> · <a href={data.sourceUrl} target="_blank" rel="noreferrer">查看原網頁與房東聯絡方式 ↗</a></>}
              {data.extra?.geocodePrecision === 'approx' && <div><small className="muted">⚠️ 地圖位置為路段概略位置,請以地址為準</small></div>}
            </div>
          )}
          {data.description && <p className="pre">{data.description}</p>}
          <Commute p={data} />
          <Checklist id={id} />

          <Reviews
            reviews={data.reviews}
            avgRating={data.avgRating}
            reviewCount={data.reviewCount}
            user={user}
            reload={load}
            postUrl={`/api/properties/${id}/reviews`}
            deleteUrl={(rid) => `/api/reviews/${rid}`}
            reportUrl={(rid) => `/api/reviews/${rid}/report`}
            placeholder="隔音、房東態度、蟲害、押金…"
            showAge
          />
        </>
      )}
      {err && <p className="error">{err}</p>}
    </aside>
  );
}
