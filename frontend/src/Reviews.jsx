// 房源與店家共用的評論區:顯示、送出、刪除、檢舉、審核狀態
import { useState } from 'react';
import { api, loginUrl } from './api.js';
import { fmtTime, isOld } from './geo.js';

export const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

const STATUS = {
  PENDING: { text: '審核中,只有你看得到', cls: 'pending' },
  REJECTED: { text: '未通過審核,只有你看得到', cls: 'rejected' },
};

/**
 * props:
 *   reviews, avgRating, reviewCount, user, reload
 *   postUrl        送出評論的 API
 *   deleteUrl(id)  刪除 API
 *   reportUrl(id)  檢舉 API
 *   minLength, placeholder, showAge
 */
export default function Reviews({ reviews, avgRating, reviewCount, user, reload, postUrl, deleteUrl, reportUrl, minLength = 10, placeholder, showAge }) {
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const mine = reviews.find((r) => r.isMine);

  const submit = async () => {
    setErr(''); setNotice(''); setBusy(true);
    try {
      const r = await api(postUrl, { method: 'POST', body: JSON.stringify({ rating, content }) });
      setContent('');
      if (r?.notice) setNotice(r.notice);
      reload();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!confirm('確定刪除這則評價?')) return;
    await api(deleteUrl(id), { method: 'DELETE' });
    reload();
  };

  const report = async (id) => {
    const reason = prompt('檢舉原因(例如:人身攻擊、不實內容、廣告)');
    if (!reason) return;
    try {
      const r = await api(reportUrl(id), { method: 'POST', body: JSON.stringify({ reason }) });
      alert(r.message);
    } catch (e) { alert(e.message); }
  };

  return (
    <>
      <h3>
        學生評價{' '}
        {avgRating && <small>{stars(avgRating)} {avgRating} ({reviewCount})</small>}
      </h3>
      {reviews.length === 0 && <p className="muted">還沒有評價</p>}
      {reviews.map((r) => (
        <div className={`review ${STATUS[r.status]?.cls || ''}`} key={r.id}>
          <div>
            {stars(r.rating)}{' '}
            <small className="muted">{fmtTime(r.createdAt)}{showAge && isOld(r.createdAt) && ' · 超過兩年,僅供參考'}</small>
          </div>
          {STATUS[r.status] && (
            <div className="mod-status">
              {STATUS[r.status].text}{r.moderationReason && `:${r.moderationReason}`}
            </div>
          )}
          <p>{r.content}</p>
          {r.isMine
            ? <button className="link" onClick={() => remove(r.id)}>刪除我的評價</button>
            : user && <button className="link subtle" onClick={() => report(r.id)}>檢舉</button>}
        </div>
      ))}

      {notice && <p className="notice">{notice}</p>}
      {user ? (
        !mine && (
          <div className="form">
            <h4>寫評價(匿名顯示)</h4>
            <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} 星</option>)}
            </select>
            <textarea rows="4" placeholder={`${placeholder}(至少 ${minLength} 字)`} value={content} onChange={(e) => setContent(e.target.value)} />
            <small className="muted">可以具體批評,但請不要辱罵、威脅或公開他人個資,否則評論會被攔下或下架。</small>
            <button onClick={submit} disabled={busy}>{busy ? '審核中…' : '送出評價'}</button>
          </div>
        )
      ) : (
        <p><a href={loginUrl}>使用中大信箱登入</a>後即可評價</p>
      )}
      {err && <p className="error">{err}</p>}
    </>
  );
}
