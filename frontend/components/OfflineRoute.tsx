import type { Ruta } from '@/lib/types';
export default function OfflineRoute({ ruta }: {
    ruta: Ruta;
}) {
    const coords = ruta.geometria.coordinates;
    if (coords.length < 2)
        return null;
    const xs = coords.map(c => c[0]), ys = coords.map(c => c[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = Math.max(maxX - minX, .00001), height = Math.max(maxY - minY, .00001);
    const scale = Math.min(320 / width, 210 / height);
    const toPoint = (c: number[]) => `${30 + (c[0] - minX) * scale},${240 - (c[1] - minY) * scale}`;
    const first = toPoint(coords[0]).split(','), last = toPoint(coords[coords.length - 1]).split(',');
    return <div className="map-fallback" style={{ position: 'absolute', inset: 0, zIndex: 4 }}><span className="badge">COPIA GUARDADA · SIN CONEXIÓN</span><h3 style={{ marginTop: 15 }}>{ruta.nombre}</h3><svg viewBox="0 0 380 270" width="100%" style={{ maxWidth: 430 }} role="img" aria-label="Esquema del recorrido guardado, sin mapa de calles"><polyline points={coords.map(toPoint).join(' ')} fill="none" stroke="var(--brand)" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round"/><circle cx={first[0]} cy={first[1]} r="7" fill="var(--brand)" stroke="#fff" strokeWidth="3"/><circle cx={last[0]} cy={last[1]} r="7" fill="#F97316" stroke="#fff" strokeWidth="3"/></svg><p style={{ fontSize: 12 }}>{(ruta.distancia / 1000).toFixed(1)} km · {Math.round(ruta.duracion / 60)} minutos estimados al guardarlo.</p><small className="muted">Esquema del recorrido. El mapa base y las condiciones actuales requieren internet.</small></div>;
}
