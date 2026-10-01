'use client';
import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MapPin } from 'lucide-react';
import { getImageProps } from 'next/image';
import { getIncidentIcon } from '@/lib/incident-icons';
import { EMPTY_MAP_DATA, MAP_STYLE, syncMapLayers, type MapLayerState } from '@/lib/map-layers';
import { api, errorMessage } from '@/lib/api';
import type { Incidente, Ruta, Posicion } from '@/lib/types';
import { RISK_COLORS } from '@/lib/types';
import RiskLegend from './RiskLegend';
import OfflineRoute from './OfflineRoute';
import 'mapbox-gl/dist/mapbox-gl.css';
type Props = {
    incidentes?: Incidente[];
    ruta?: Ruta | null;
    onSelect?: (incidente: Incidente) => void;
    onPosition?: (p: Posicion) => void | boolean;
    posicion?: Posicion | null;
    editor?: boolean;
};
const brandColor = (element: HTMLElement | null) => element ? getComputedStyle(element).getPropertyValue('--map-route-color').trim() || '#1554D8' : '#1554D8';
export default function MapView({ incidentes = [], ruta = null, onSelect, onPosition, posicion = null, editor = false }: Props) {
    const container = useRef<HTMLDivElement>(null), mapRef = useRef<mapboxgl.Map | null>(null), markers = useRef<mapboxgl.Marker[]>([]), positionMarker = useRef<mapboxgl.Marker | null>(null);
    const callbacks = useRef({ onSelect, onPosition });
    const [loaded, setLoaded] = useState(false), [risk, setRisk] = useState(true), [events, setEvents] = useState(true), [zones, setZones] = useState(true), [error, setError] = useState(''), [roads, setRoads] = useState<GeoJSON.FeatureCollection>(EMPTY_MAP_DATA), [roadError, setRoadError] = useState('');
    const styleReady = useRef(false);
    const layerState = useRef<MapLayerState>({ roads, incidents: incidentes, route: ruta, risk, events, zones, editor, brand: '#1554D8', routeOutline: '#fff' });
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    const [online, setOnline] = useState(true);
    useEffect(() => { const change = () => setOnline(navigator.onLine); window.addEventListener('online', change); window.addEventListener('offline', change); void Promise.resolve().then(change); return () => { window.removeEventListener('online', change); window.removeEventListener('offline', change); }; }, []);
    useEffect(() => { callbacks.current = { onSelect, onPosition }; }, [onSelect, onPosition]);
    useEffect(() => {
        layerState.current = { roads, incidents: incidentes, route: ruta, risk, events, zones, editor,
            brand: brandColor(container.current),
            routeOutline: container.current ? getComputedStyle(container.current).getPropertyValue('--map-route-outline').trim() || '#fff' : '#fff' };
        if (mapRef.current && styleReady.current) syncMapLayers(mapRef.current, layerState.current);
    }, [roads, incidentes, ruta, risk, events, zones, editor]);
    useEffect(() => {
        if (!container.current || !token)
            return;
        const map = new mapboxgl.Map({ container: container.current, accessToken: token, style: MAP_STYLE, center: [posicion?.longitud ?? -75.7286, posicion?.latitud ?? -14.0678], zoom: editor ? 17 : 13.3, attributionControl: true });
        mapRef.current = map;
        map.addControl(new mapboxgl.NavigationControl(), 'top-right');
        map.addControl(new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: !editor, showUserHeading: true }), 'top-right');
        map.on('style.load', () => {
            styleReady.current = true;
            syncMapLayers(map, layerState.current);
            setLoaded(true);
            setError('');
        });
        map.on('error', e => { if (e.error?.message?.includes('token') || e.error?.message?.includes('401') || e.error?.message?.includes('403'))
            setError('No se pudo cargar Mapbox. Revisa el token público y sus restricciones.'); });
        if (editor)
            map.on('click', e => callbacks.current.onPosition?.({ latitud: e.lngLat.lat, longitud: e.lngLat.lng }));
        return () => { styleReady.current = false; markers.current.forEach(m => m.remove()); markers.current = []; positionMarker.current?.remove(); positionMarker.current = null; map.remove(); mapRef.current = null; };
        // The map is initialized once. Later coordinate changes update its marker.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, editor]);
    useEffect(() => { if (editor)
        return; let active = true; const controller = new AbortController(); const get = async () => { try {
        const data = await api<GeoJSON.FeatureCollection>('/navigation/roads', { signal: controller.signal });
        if (active) {
            setRoads(data);
            setRoadError('');
        }
    }
    catch (err) {
        if (active)
            setRoadError(errorMessage(err));
    } }; void get(); const timer = setInterval(get, 30000); return () => { active = false; controller.abort(); clearInterval(timer); }; }, [editor]);
    useEffect(() => {
        const map = mapRef.current;
        if (!loaded || !map)
            return;
        markers.current.forEach(m => m.remove());
        markers.current = [];
        if (!events || editor)
            return;
        for (const incident of incidentes) {
            if (!Number.isFinite(incident.longitud) || !Number.isFinite(incident.latitud))
                continue;
            const button = document.createElement('button');
            button.className = 'incident-marker';
            button.type = 'button';
            const level = incident.gravedad ?? incident.nivelRiesgo;
            const color = level == null ? '#64748b' : RISK_COLORS[Math.max(0, Math.min(5, level))];
            const asset = getIncidentIcon(incident.tipoSlug, incident.tipoNombre, incident.tipo);
            if (asset) {
                button.classList.add('incident-marker-with-icon');
                button.style.setProperty('--incident-gravity-color', color);
                const frame = document.createElement('span');
                frame.className = 'incident-type-icon';
                frame.setAttribute('aria-hidden', 'true');
                const image = document.createElement('img');
                const width = Math.round(32 * (asset.scale ?? 1));
                const { props } = getImageProps({ src: asset.image, alt: '', width, height: Math.round(width * asset.image.height / asset.image.width), sizes: `${width}px`, loading: 'eager' });
                // Reuse Next's optimizer instead of downloading the multi-MB PNG
                // for each small DOM marker.
                image.sizes = props.sizes ?? '';
                image.srcset = props.srcSet ?? '';
                image.src = props.src;
                image.alt = '';
                image.width = props.width ?? width;
                image.height = props.height ?? width;
                image.decoding = 'async';
                image.style.transform = `scale(${asset.scale ?? 1})`;
                frame.appendChild(image);
                button.appendChild(frame);
                const badge = document.createElement('span');
                badge.className = 'incident-marker-level';
                badge.textContent = level == null ? '?' : String(level);
                badge.setAttribute('aria-hidden', 'true');
                button.appendChild(badge);
            } else {
                button.textContent = level == null ? '?' : String(level);
                button.style.background = color;
            }
            button.style.color = level == null || level >= 5 ? '#fff' : 'var(--risk-badge-ink, #142033)';
            button.setAttribute('aria-label', `${incident.tipoNombre || incident.tipo}, gravedad ${level ?? 'por evaluar'}`);
            button.addEventListener('click', () => callbacks.current.onSelect?.(incident));
            const marker = new mapboxgl.Marker({ element: button }).setLngLat([incident.longitud, incident.latitud]).addTo(map);
            // Mapbox assigns role="img" even to custom buttons during construction.
            button.setAttribute('role', 'button');
            markers.current.push(marker);
        }
    }, [loaded, incidentes, events, editor]);
    useEffect(() => { const map = mapRef.current; if (!loaded || !map)
        return; if (ruta?.geometria.coordinates.length) {
        const bounds = new mapboxgl.LngLatBounds();
        ruta.geometria.coordinates.forEach(c => bounds.extend([c[0], c[1]]));
        map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 700 });
    } }, [loaded, ruta]);
    useEffect(() => { const map = mapRef.current; if (!loaded || !map || !posicion)
        return; positionMarker.current?.remove(); positionMarker.current = new mapboxgl.Marker({ color: brandColor(container.current), draggable: editor }).setLngLat([posicion.longitud, posicion.latitud]).addTo(map); if (editor) {
        positionMarker.current.on('dragend', () => { const coords = positionMarker.current?.getLngLat(); if (coords) {
            const accepted = callbacks.current.onPosition?.({ latitud: coords.lat, longitud: coords.lng });
            if (accepted === false)
                positionMarker.current?.setLngLat([posicion.longitud, posicion.latitud]);
        } });
        map.easeTo({ center: [posicion.longitud, posicion.latitud], duration: 300 });
    } }, [loaded, posicion, editor]);
    return <><div className="map-container" ref={container}/>{!online && ruta && <OfflineRoute ruta={ruta}/>}{!token && <div className="map-fallback" style={{ position: 'absolute', inset: 0 }}><MapPin size={38} color="var(--brand)"/><h3 style={{ marginTop: 15 }}></div>}{!editor && <><div className="map-controls"><label><input type="checkbox" checked={risk} onChange={e => setRisk(e.target.checked)}/>Riesgo por tramo</label><label><input type="checkbox" checked={events} onChange={e => setEvents(e.target.checked)}/>Incidentes</label><label><input type="checkbox" checked={zones} onChange={e => setZones(e.target.checked)} disabled={!events}/>Zonas de incidentes</label></div><RiskLegend /></>}{(error || roadError && !editor) && <div className="map-message notice notice-warning">{error || `La capa vial no está disponible: ${roadError}`}</div>}</>;
}
