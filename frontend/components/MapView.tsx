'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MapPin, LocateFixed } from 'lucide-react';
import { getImageProps } from 'next/image';
import { getIncidentIcon } from '@/lib/incident-icons';
import { EMPTY_MAP_DATA, MAP_STYLE, bindIncidentMarkerZoom, syncMapLayers, type MapLayerState } from '@/lib/map-layers';
import { api, errorMessage } from '@/lib/api';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import type { IncidentFilterGroup } from '@/lib/incident-filters';
import type { Incidente, Ruta, Posicion, LocationFix } from '@/lib/types';
import { RISK_COLORS } from '@/lib/types';
import type { TrafficResponse, TrafficStatus, ExternalTrafficIncident } from '@/lib/traffic';
import { trafficAffectsRoute } from '@/lib/traffic';
import { syncTrafficLayer } from '@/lib/map-traffic-layers';
import RiskLegend from './RiskLegend';
import OfflineRoute from './OfflineRoute';
import CollapsiblePanel from './CollapsiblePanel';
import 'mapbox-gl/dist/mapbox-gl.css';
type Props = {
    incidentes?: Incidente[];
    ruta?: Ruta | null;
    onSelect?: (incidente: Incidente) => void;
    onPosition?: (p: Posicion) => void | boolean;
    onLocate?: (p: LocationFix) => void;
    posicion?: Posicion | null;
    editor?: boolean;
    navigating?: boolean;
    heading?: number;
    centerVersion?: number;
    onTrafficChange?: () => void;
    typeFilter?: { value: string; groups: IncidentFilterGroup[]; onChange: (value: string) => void };
};
const brandColor = (element: HTMLElement | null) => element ? getComputedStyle(element).getPropertyValue('--map-route-color').trim() || '#1554D8' : '#1554D8';
const EMPTY_INCIDENTS: Incidente[] = [];
export default function MapView({ incidentes = EMPTY_INCIDENTS, ruta = null, onSelect, onPosition, onLocate, posicion = null, editor = false, typeFilter, navigating = false, heading, centerVersion = 0, onTrafficChange }: Props) {
    const container = useRef<HTMLDivElement>(null), mapRef = useRef<mapboxgl.Map | null>(null), markers = useRef<mapboxgl.Marker[]>([]), positionMarker = useRef<mapboxgl.Marker | null>(null);
    const callbacks = useRef({ onSelect, onPosition, onLocate });
    const [loaded, setLoaded] = useState(false), [risk, setRisk] = useState(true), [events, setEvents] = useState(true), [zones, setZones] = useState(true), [error, setError] = useState(''), [roads, setRoads] = useState<GeoJSON.FeatureCollection>(EMPTY_MAP_DATA), [roadError, setRoadError] = useState('');
    const styleReady = useRef(false);
    const [controlsOpen, setControlsOpen] = useState(false), [legendOpen, setLegendOpen] = useState(true), [traffic, setTraffic] = useState(false);
    const [trafficStatus, setTrafficStatus] = useState<TrafficStatus | null>(null), [trafficData, setTrafficData] = useState<TrafficResponse | null>(null), [externalSelected, setExternalSelected] = useState<ExternalTrafficIncident | null>(null);
    const [trafficError, setTrafficError] = useState('');
    const externalMarkers = useRef<mapboxgl.Marker[]>([]), trafficSnapshot = useRef(''), followCamera = useRef(true), cameraState = useRef({navigating, posicion, heading});
    const trafficCallback = useRef(onTrafficChange);
    const trafficLayerState = useRef({enabled: false, url: ''});
    const activeTrafficRoute = useRef(ruta);
    useEffect(() => { activeTrafficRoute.current = ruta; }, [ruta]);
    useEffect(() => { cameraState.current = {navigating, posicion, heading}; trafficCallback.current = onTrafficChange; }, [navigating, posicion, heading, onTrafficChange]);
    const filterId = useId();
    const layerState = useRef<MapLayerState>({ roads, incidents: incidentes, route: ruta, risk, events, zones, editor, brand: '#1554D8', routeOutline: '#fff' });
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    const [online, setOnline] = useState(true);
    useEffect(() => { const change = () => setOnline(navigator.onLine); window.addEventListener('online', change); window.addEventListener('offline', change); void Promise.resolve().then(change); return () => { window.removeEventListener('online', change); window.removeEventListener('offline', change); }; }, []);
    useEffect(() => { callbacks.current = { onSelect, onPosition, onLocate }; }, [onSelect, onPosition, onLocate]);
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
        const stopMarkerZoom = bindIncidentMarkerZoom(map);
        map.addControl(new mapboxgl.NavigationControl(), editor ? 'top-right' : 'bottom-right');
        const geolocate = new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false, showUserHeading: true });
        geolocate.on('geolocate', (event: GeolocationPosition) => callbacks.current.onLocate?.({ latitud: event.coords.latitude, longitud: event.coords.longitude, accuracy: event.coords.accuracy, timestamp: event.timestamp }));
        map.addControl(geolocate, editor ? 'top-right' : 'bottom-right');
        map.on('dragstart', () => { followCamera.current = false; });
        map.on('rotatestart', e => { if (e.originalEvent) followCamera.current = false; });
        map.on('style.load', () => {
            styleReady.current = true;
            syncMapLayers(map, layerState.current);
            if (!editor) syncTrafficLayer(map, trafficLayerState.current.enabled, trafficLayerState.current.url);
            setLoaded(true);
            setError('');
        });
        map.on('error', e => { if ('sourceId' in e && e.sourceId === 'tomtom-flow') setTrafficError('La capa de tráfico no se pudo actualizar. Puedes consultar el riesgo y los recorridos locales.'); else if (e.error?.message?.includes('token') || e.error?.message?.includes('401') || e.error?.message?.includes('403'))
            setError('No se pudo cargar Mapbox. Revisa el token público y sus restricciones.'); });
        if (editor)
            map.on('click', e => callbacks.current.onPosition?.({ latitud: e.lngLat.lat, longitud: e.lngLat.lng }));
        return () => { stopMarkerZoom(); styleReady.current = false; markers.current.forEach(m => m.remove()); markers.current = []; externalMarkers.current.forEach(m => m.remove()); externalMarkers.current = []; positionMarker.current?.remove(); positionMarker.current = null; map.remove(); mapRef.current = null; };
        // The map is initialized once. Later coordinate changes update its marker.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, editor]);
    const loadRoads = useCallback(async (signal: AbortSignal) => { if (editor) return; try {
        const data = await api<GeoJSON.FeatureCollection>('/navigation/roads', { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
        if (!signal.aborted) {
            setRoads(data);
            setRoadError('');
        }
    }
    catch (err) {
        if (!signal.aborted)
            setRoadError(err instanceof Error && err.name === 'TimeoutError' ? 'La actualización está tardando demasiado. Volveremos a intentarlo automáticamente.' : errorMessage(err));
    } }, [editor]);
    const refreshRoads = useLiveRefresh(loadRoads, 30000);
    const previousIncidents = useRef(incidentes);
    useEffect(() => {
        if (previousIncidents.current === incidentes) return;
        previousIncidents.current = incidentes;
        if (!editor) refreshRoads();
    }, [incidentes, editor, refreshRoads]);
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
    useEffect(() => { const map = mapRef.current; if (!loaded || !map || navigating)
        return; if (ruta?.geometria.coordinates.length) {
        const bounds = new mapboxgl.LngLatBounds();
        ruta.geometria.coordinates.forEach(c => bounds.extend([c[0], c[1]]));
        map.fitBounds(bounds, { padding: {top: 60, bottom: 100, left: 60, right: Math.min(340, Math.max(60, map.getContainer().clientWidth * .4))}, maxZoom: 16, bearing: 0, pitch: 0, duration: 700 });
    } }, [loaded, ruta, navigating]);
    useEffect(() => { const map = mapRef.current; if (!loaded || !map) return;
        if (!posicion) { positionMarker.current?.remove(); positionMarker.current = null; return; }
        if (!positionMarker.current) { positionMarker.current = new mapboxgl.Marker({ color: brandColor(container.current), draggable: editor }).setLngLat([posicion.longitud, posicion.latitud]).addTo(map); } else positionMarker.current.setLngLat([posicion.longitud, posicion.latitud]); if (editor) {
        positionMarker.current.off('dragend', onDrag);
        function onDrag() { const coords = positionMarker.current?.getLngLat(); if (coords) {
            const accepted = callbacks.current.onPosition?.({ latitud: coords.lat, longitud: coords.lng });
            if (accepted === false) positionMarker.current?.setLngLat([posicion!.longitud, posicion!.latitud]);
        } }
        positionMarker.current.on('dragend', onDrag);
        map.easeTo({ center: [posicion.longitud, posicion.latitud], duration: 300 });
        return () => { positionMarker.current?.off('dragend', onDrag); };
    } else if (navigating && followCamera.current) map.easeTo({center: [posicion.longitud, posicion.latitud], zoom: Math.max(16, map.getZoom()), bearing: heading ?? 0, pitch: 35, duration: 700}); }, [loaded, posicion, editor, navigating, heading]);
    const centerOnPosition = () => { followCamera.current = true; const map = mapRef.current, state = cameraState.current; if (map && state.posicion) map.easeTo({center: [state.posicion.longitud, state.posicion.latitud], zoom: 16.5, bearing: state.navigating ? state.heading ?? 0 : 0, pitch: state.navigating ? 35 : 0, duration: 500}); };
    useEffect(() => {
        if (!navigating) return;
        followCamera.current = true;
        const map = mapRef.current, state = cameraState.current;
        if (map && state.posicion) map.easeTo({center: [state.posicion.longitud, state.posicion.latitud], zoom: 16.5, bearing: state.heading ?? 0, pitch: 35, duration: 500});
    }, [centerVersion, navigating]);
    const loadTraffic = useCallback(async (signal: AbortSignal) => {
        if (editor) return;
        try {
            const status = await api<TrafficStatus>('/navigation/traffic/status', {signal});
            if (signal.aborted) return; setTrafficStatus(status);
            const data = await api<TrafficResponse>('/navigation/traffic/incidents', {signal});
            if (signal.aborted) return; setTrafficData(data); setExternalSelected(current => current ? data.incidentes.find(i => i.id === current.id) ?? null : null);
            const currentRoute = activeTrafficRoute.current;
            const snapshot = JSON.stringify(data.incidentes.filter(i => trafficAffectsRoute(i, currentRoute, 80)).map(i => [i.id, i.tipo, i.demoraSegundos]));
            if (trafficSnapshot.current && snapshot !== trafficSnapshot.current) trafficCallback.current?.();
            trafficSnapshot.current = snapshot;
        } catch { if (!signal.aborted) setTrafficData({incidentes: [], trafico: {disponible: false, fuente: null, actualizadoEn: null, motivo: 'No se pudo actualizar el tráfico. Se mantienen disponibles los recorridos de CiviGo.'}}); }
    }, [editor]);
    useLiveRefresh(loadTraffic, 120000);
    const tilesExhausted = trafficStatus?.cuotas?.tiles?.restantes === 0;
    const trafficReady = trafficStatus?.configurado && trafficStatus.habilitado && trafficStatus.controlCuotaDisponible && !tilesExhausted;
    useEffect(() => {
        trafficLayerState.current = {enabled: Boolean(traffic && trafficReady && !editor), url: `${window.location.origin}/api/navigation/traffic/tiles/flow/{z}/{x}/{y}.png`};
        const map = mapRef.current; if (!loaded || !map || editor) return;
        syncTrafficLayer(map, trafficLayerState.current.enabled, trafficLayerState.current.url);
    }, [loaded, traffic, trafficReady, editor]);
    useEffect(() => {
        const map = mapRef.current; externalMarkers.current.forEach(m => m.remove()); externalMarkers.current = [];
        if (!loaded || !map || !events || editor) return;
        for (const item of trafficData?.incidentes ?? []) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'incident-marker external-traffic-marker'; button.textContent = '!'; button.setAttribute('aria-label', `${item.titulo} · TomTom`); button.addEventListener('click', () => setExternalSelected(item));
            const marker = new mapboxgl.Marker({element: button}).setLngLat([item.longitud, item.latitud]).addTo(map); button.setAttribute('role', 'button'); externalMarkers.current.push(marker);
        }
    }, [loaded, trafficData, events, editor]);
    return <><div className="map-container" ref={container}/>{!online && ruta && <OfflineRoute ruta={ruta}/>}{!token && <div className="map-fallback" style={{ position: 'absolute', inset: 0 }}><MapPin size={38} color="var(--brand)"/></div>}{!editor && <>
        <CollapsiblePanel title={typeFilter?.value ? 'Capas y filtros · 1 filtro' : 'Capas y filtros'} className="map-controls" open={controlsOpen} onOpenChange={setControlsOpen}>
            <div className="map-layer-options">
                <label><input type="checkbox" checked={risk} onChange={e => { setRisk(e.target.checked); if (e.target.checked) setTraffic(false); }}/>Riesgo por tramo</label>
                <label><input type="checkbox" checked={traffic} onChange={e => {setTraffic(e.target.checked); setTrafficError(''); if (e.target.checked) setRisk(false);}} disabled={!trafficReady}/>Tráfico · TomTom</label>
                {!trafficReady && <small className="muted">{tilesExhausted ? 'Se alcanzó la cuota de la capa de tráfico. Los recorridos locales siguen disponibles.' : trafficData?.trafico.motivo || 'Tráfico en tiempo real no disponible.'}</small>}
                <label><input type="checkbox" checked={events} onChange={e => setEvents(e.target.checked)}/>Incidentes</label>
                <label><input type="checkbox" checked={zones} onChange={e => setZones(e.target.checked)} disabled={!events}/>Zonas de incidentes</label>
            </div>
            {typeFilter && <div className="map-type-filter field">
                <label htmlFor={filterId}>Filtrar por tipo</label>
                <select id={filterId} value={typeFilter.value} onChange={e => { typeFilter.onChange(e.target.value); setEvents(true); }}>
                    <option value="">Todos los tipos</option>
                    {typeFilter.groups.map(group => <optgroup key={group.key} label={group.name}>{group.types.map(type => <option key={type.key} value={type.key}>{type.name}</option>)}</optgroup>)}
                </select>
                {typeFilter.value && <button type="button" className="btn btn-quiet btn-small" onClick={() => typeFilter.onChange('')}>Quitar filtro</button>}
                <small>Filtra los marcadores, sus zonas y los reportes recientes. El riesgo de las calles considera todos los incidentes.</small>
            </div>}
        </CollapsiblePanel>
        {traffic ? <CollapsiblePanel title="Tráfico · TomTom" className="risk-legend traffic-legend" open={legendOpen} onOpenChange={setLegendOpen}>{trafficError && <p role="status">{trafficError}</p>}<div className="traffic-scale"><span>Fluido</span><span>Lento</span><span>Congestionado</span></div><small>{trafficData?.trafico.actualizadoEn ? `Datos ${new Date(trafficData.trafico.actualizadoEn).toLocaleTimeString('es-PE', {hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima'})}` : 'Sin actualización disponible'}</small><p>Los avisos temporales no suman puntos de riesgo. © TomTom</p></CollapsiblePanel> : <RiskLegend open={legendOpen} onOpenChange={setLegendOpen} />}
        {posicion && <button className="map-recenter icon-btn" aria-label="Centrar mi ubicación" onClick={centerOnPosition}><LocateFixed size={20}/></button>}
        {externalSelected && events && <div className="external-traffic-detail"><button className="icon-btn" aria-label="Cerrar aviso de tráfico" onClick={() => setExternalSelected(null)}>×</button><strong>{externalSelected.titulo}</strong><p>{externalSelected.descripcion}</p><small>TomTom · aviso temporal · no suma riesgo histórico</small></div>}
    </>}{(error || roadError && !editor) && <div className="map-message notice notice-warning">{error || `La capa vial no está disponible: ${roadError}`}</div>}</>;
}
