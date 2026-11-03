import { useEffect, useState } from 'react';
import { STATIONS, rideMin, walkMin, nearestStop, dist } from './geo.js';

export function Commute({ p }) {
  const stop = nearestStop(p);
  return (
    <div className="box">
      <h4>🛵 通勤時間(估算)</h4>
      {STATIONS.map((s) => (
        <div key={s.name}>{s.name}:騎車約 <b>{rideMin(p, s)}</b> 分({(dist(p, s) / 1000).toFixed(1)} 公里直線)</div>
      ))}
      <div>{stop ? <>最近公車站「{stop.name}」:走路約 <b>{walkMin(p, stop)}</b> 分</> : <span className="muted">尚未建立公車站牌資料</span>}</div>
      <small className="muted">依直線距離 ×1.3 推估,實際以導航為準</small>
    </div>
  );
}

const ITEMS = ['水壓與熱水', '馬桶、排水是否順暢', '牆面壁癌、漏水痕跡', '採光與通風', '插座數量與位置', '手機訊號與網路', '隔音(敲牆、聽鄰居)', '門窗與鎖具', '冷氣、熱水器運作', '蟲蟻痕跡', '電費計價方式', '房東同意申請租補', '押金與違約條款', '垃圾處理方式', '夜間周邊環境與照明'];

export function Checklist({ id }) {
  const key = `checklist:${id}`;
  const [done, setDone] = useState([]);
  useEffect(() => { try { setDone(JSON.parse(localStorage.getItem(key)) || []); } catch { setDone([]); } }, [key]);
  const toggle = (i) => {
    const next = done.includes(i) ? done.filter((x) => x !== i) : [...done, i];
    setDone(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch {}
  };
  return (
    <details className="box">
      <summary>📋 看房檢查清單({done.length}/{ITEMS.length})</summary>
      {ITEMS.map((t, i) => (
        <label key={i} className="chk"><input type="checkbox" checked={done.includes(i)} onChange={() => toggle(i)} />{t}</label>
      ))}
    </details>
  );
}
