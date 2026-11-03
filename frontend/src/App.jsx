import { useEffect, useState } from 'react';
import MapView from './MapView.jsx';
import DetailPanel from './DetailPanel.jsx';
import EateryPanel from './EateryPanel.jsx';
import Terms from './Terms.jsx';
import { api, loginUrl } from './api.js';
import { TYPE_LABEL, DAYS } from './geo.js';

const CATS = ['早餐', '中式', '日式', '小吃', '飲料', '咖啡甜點', '宵夜'];

export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState('rent');
  const [bbox, setBbox] = useState(null);
  const [f, setF] = useState({ subsidy: false, trash: false, parking: false, maxPrice: '', type: '', category: '' });
  const [props, setProps] = useState([]);
  const [eats, setEats] = useState([]);
  const [garbage, setGarbage] = useState([]);
  const [showGarbage, setShowGarbage] = useState(false);
  const [sel, setSel] = useState(null);
  const [banner, setBanner] = useState('');
  const [terms, setTerms] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    api('/auth/me').then(setUser).catch(() => setUser(null));
    api('/api/garbage-stops').then(setGarbage).catch(() => {});
    const err = new URLSearchParams(location.search).get('error');
    if (err) { setBanner(err === 'DOMAIN_NOT_ALLOWED' ? '只有 @g.ncu.edu.tw 信箱可以登入' : '登入失敗,請再試一次'); history.replaceState({}, '', '/'); }
  }, []);

  useEffect(() => {
    if (!bbox) return;
    const q = new URLSearchParams({ bbox });
    if (tab === 'rent') {
      ['subsidy', 'trash', 'parking'].forEach((k) => f[k] && q.set(k, 'true'));
      if (f.maxPrice) q.set('maxPrice', f.maxPrice);
      if (f.type) q.set('type', f.type);
      api(`/api/properties?${q}`).then(setProps).catch(() => setProps([]));
    } else {
      if (f.category) q.set('category', f.category);
      api(`/api/eateries?${q}`).then(setEats).catch(() => setEats([]));
    }
  }, [bbox, f, tab]);

  const switchTab = (t) => { setTab(t); setSel(null); };
  const markers = [
    ...(tab === 'rent'
      ? props.map((p) => ({ key: 'p' + p.id, lat: p.lat, lng: p.lng, onClick: () => setSel(p.id),
          html: `<div class="pin ${p.id === sel ? 'active' : ''} ${p.listingType !== 'RENT' ? 'sub' : ''}">$${(p.price / 1000).toFixed(1)}k</div>` }))
      : eats.map((e) => ({ key: 'e' + e.id, lat: e.lat, lng: e.lng, w: 96, onClick: () => setSel(e.id),
          html: `<div class="pin food ${e.id === sel ? 'active' : ''}">🍴 ${e.name.slice(0, 6)}</div>` }))),
    ...(showGarbage ? garbage.map((g) => ({ key: 'g' + g.id, lat: g.lat, lng: g.lng, w: 34, html: '<div class="pin garbage">🚛</div>',
      popup: <div><b>{g.name}</b><br />每週{g.days.map((d) => DAYS[d]).join('、')} {g.arrivalTime}{g.note && <><br />{g.note}</>}</div> })) : []),
  ];
  const count = tab === 'rent' ? props.length : eats.length;

  return (
    <div className="app">
      <header>
        <strong>🏠 NCU-Rent</strong>
        <nav className="tabs">
          <button className={tab === 'rent' ? 'on' : ''} onClick={() => switchTab('rent')}>租屋</button>
          <button className={tab === 'food' ? 'on' : ''} onClick={() => switchTab('food')}>美食</button>
        </nav>
        <div className="filters">
          {tab === 'rent' ? (
            <>
              <label><input type="checkbox" checked={f.subsidy} onChange={() => set('subsidy', !f.subsidy)} />可租補</label>
              <label><input type="checkbox" checked={f.trash} onChange={() => set('trash', !f.trash)} />垃圾代收</label>
              <label><input type="checkbox" checked={f.parking} onChange={() => set('parking', !f.parking)} />室內機車位</label>
              <select value={f.type} onChange={(e) => set('type', e.target.value)}>
                <option value="">全部類型</option>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={f.maxPrice} onChange={(e) => set('maxPrice', e.target.value)}>
                <option value="">不限租金</option>
                {[5000, 7000, 9000, 12000].map((n) => <option key={n} value={n}>≤ {n}</option>)}
              </select>
            </>
          ) : (
            <select value={f.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">全部分類</option>
              {CATS.map((c) => <option key={c}>{c}</option>)}
            </select>
          )}
          <label><input type="checkbox" checked={showGarbage} onChange={() => setShowGarbage(!showGarbage)} />🚛 垃圾車</label>
          <small>{count} 間</small>
        </div>
        <div className="auth">
          {user ? <>{user.email.split('@')[0]} <button className="link" onClick={async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); }}>登出</button></> : <a href={loginUrl}>中大信箱登入</a>}
        </div>
      </header>
      {banner && <div className="banner" onClick={() => setBanner('')}>{banner}</div>}
      <main>
        <MapView markers={markers} onBounds={setBbox} />
        {sel && (tab === 'rent' ? <DetailPanel id={sel} user={user} onClose={() => setSel(null)} /> : <EateryPanel id={sel} user={user} onClose={() => setSel(null)} />)}
      </main>
      <footer><button className="link" onClick={() => setTerms(true)}>使用條款與免責聲明</button> · 平台僅供中大學生資訊交流</footer>
      {terms && <Terms onClose={() => setTerms(false)} />}
    </div>
  );
}
