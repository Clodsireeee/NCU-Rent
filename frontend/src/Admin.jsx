// 管理員:評論審核後台
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { stars } from './Reviews.jsx';
import { fmtTime } from './geo.js';

const FLAG = {
  profanity: '髒話', insult: '人身攻擊', threat: '威脅', hate: '仇恨', sexual: '性騷擾',
  personal_info: '個資', spam: '廣告', other: '其他',
};

export default function Admin({ onClose }) {
  const [status, setStatus] = useState('PENDING');
  const [reportedOnly, setReportedOnly] = useState(false);
  const [list, setList] = useState(null);
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState('');

  const load = () => {
    setList(null);
    api(`/api/admin/moderation?status=${status}${reportedOnly ? '&reported=true' : ''}`).then(setList).catch((e) => setErr(e.message));
    api('/api/admin/stats').then(setStats).catch(() => {});
  };
  useEffect(load, [status, reportedOnly]);

  const act = async (r, action) => {
    let reason;
    if (action === 'reject') { reason = prompt('駁回原因(作者會看到)', '內容含人身攻擊,請修改後重新送出'); if (reason === null) return; }
    if (action === 'delete' && !confirm('永久刪除這則評論?')) return;
    try {
      await api(`/api/admin/moderation/${r.kind}/${r.id}`, { method: 'POST', body: JSON.stringify({ action, reason }) });
      setList((l) => l.filter((x) => !(x.kind === r.kind && x.id === r.id)));
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box wide" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>✕</button>
        <h3>評論審核</h3>
        {stats && (
          <p className="muted">
            待審 {stats.pendingReviews} · 未處理檢舉 {stats.openReports} · 校園消息 {stats.campusPosts} 則 · 房源{' '}
            {Object.entries(stats.properties).map(([k, v]) => `${k} ${v}`).join(' / ')}
          </p>
        )}
        <div className="campus-bar">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="PENDING">待審核</option>
            <option value="REJECTED">已駁回</option>
            <option value="PUBLISHED">已公開</option>
          </select>
          <label><input type="checkbox" checked={reportedOnly} onChange={() => setReportedOnly(!reportedOnly)} />只看被檢舉的</label>
        </div>
        {err && <p className="error">{err}</p>}
        {!list && !err && <p>載入中…</p>}
        {list?.length === 0 && <p className="muted">沒有資料 🎉</p>}
        {list?.map((r) => (
          <div key={`${r.kind}${r.id}`} className="review admin-item">
            <div>
              {stars(r.rating)} <small className="muted">{fmtTime(r.updatedAt)} · {r.target.type === 'property' ? '🏠' : '🍴'} {r.target.title} · {r.authorEmail}</small>
            </div>
            <p>{r.content}</p>
            <div className="tags">
              {r.moderationFlags.map((f) => <span key={f} className="full">{FLAG[f] || f}</span>)}
              {r.moderationReason && <small className="muted">{r.moderationReason}</small>}
            </div>
            {r.reports.length > 0 && (
              <ul className="reports">{r.reports.map((p, i) => <li key={i}>檢舉:{p.reason}</li>)}</ul>
            )}
            <div className="admin-actions">
              {r.status !== 'PUBLISHED' && <button onClick={() => act(r, 'approve')}>✅ 公開</button>}
              {r.status !== 'REJECTED' && <button onClick={() => act(r, 'reject')}>🚫 駁回</button>}
              <button className="danger" onClick={() => act(r, 'delete')}>🗑 刪除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
