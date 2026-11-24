import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

const NCU = [24.968, 121.1867];

// 地圖移動或縮放結束時,把目前的可視範圍(bbox)和縮放等級回報給上層
function BoundsWatcher({ onChange, onZoom }) {
  const map = useMap();
  const emit = () => {
    onChange(map.getBounds().toBBoxString());
    onZoom(map.getZoom());
  };
  useMapEvents({ moveend: emit, zoomend: emit });
  useEffect(() => { emit(); }, []);
  return null;
}

// 地圖容器從隱藏變回顯示時,讓 Leaflet 重新計算尺寸,否則圖磚會破碎
function Resizer({ visible }) {
  const map = useMap();
  useEffect(() => { if (visible) setTimeout(() => map.invalidateSize(), 0); }, [visible]);
  return null;
}

// 中央大學標籤:依縮放等級切換「完整文字 / 只有圖示 / 隱藏」
function campusIcon(zoom) {
  if (zoom >= 16) {
    return L.divIcon({ className: '', html: '<div class="campus">🎓 中央大學</div>', iconSize: [110, 24], iconAnchor: [55, 12] });
  }
  return L.divIcon({ className: '', html: '<div class="campus small">🎓</div>', iconSize: [26, 24], iconAnchor: [13, 12] });
}

// markers: [{ key, lat, lng, html, w, onClick, popup }]
export default function MapView({ markers, onBounds, visible = true }) {
  const [zoom, setZoom] = useState(16);
  return (
    <MapContainer center={NCU} zoom={16} className="map">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <BoundsWatcher onChange={onBounds} onZoom={setZoom} />
      <Resizer visible={visible} />
      {zoom >= 14 && (
        <Marker position={NCU} interactive={false} zIndexOffset={-1000} icon={campusIcon(zoom)} />
      )}
      {markers.map((m) => {
        const w = m.w || 58;
        return (
          <Marker key={m.key} position={[m.lat, m.lng]} icon={L.divIcon({ className: '', html: m.html, iconSize: [w, 26], iconAnchor: [w / 2, 26] })} eventHandlers={m.onClick ? { click: m.onClick } : {}}>
            {m.popup && <Popup>{m.popup}</Popup>}
          </Marker>
        );
      })}
    </MapContainer>
  );
}