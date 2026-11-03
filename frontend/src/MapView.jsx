import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

const NCU = [24.968, 121.1867];

function BoundsWatcher({ onChange }) {
  const map = useMap();
  const emit = () => onChange(map.getBounds().toBBoxString());
  useMapEvents({ moveend: emit });
  useEffect(() => { emit(); }, []);
  return null;
}

// markers: [{ key, lat, lng, html, w, onClick, popup }]
export default function MapView({ markers, onBounds }) {
  return (
    <MapContainer center={NCU} zoom={16} className="map">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <BoundsWatcher onChange={onBounds} />
      <Marker position={NCU} interactive={false} icon={L.divIcon({ className: '', html: '<div class="campus">🎓 中央大學</div>', iconSize: [90, 24], iconAnchor: [45, 12] })} />
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
