'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MapPin, LocateFixed, Compass } from 'lucide-react';
import { getImageProps } from 'next/image';
import { getIncidentIcon } from '@/lib/incident-icons';
import { EMPTY_MAP_DATA, MAP_STYLE, bindIncidentMarkerZoom, syncMapLayers, type MapLayerState } from '@/lib/map-layers';
import { api, errorMessage } from '@/lib/api';
import { applyRoadRisk, type RoadGeometry, type RoadRisk } from '@/lib/road-map';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import type { IncidentFilterGroup } from '@/lib/incident-filters';
import type { Incidente, Ruta, Posicion, LocationFix } from '@/lib/types';
import { RISK_COLORS } from '@/lib/types';
import type { TrafficResponse, TrafficStatus, ExternalTrafficIncident } from '@/lib/traffic';
import { trafficAffectsRoute, trafficFlowMessage } from '@/lib/traffic';
import { syncTrafficLayer } from '@/lib/map-traffic-layers';
import { resetMapOrientation } from '@/lib/map-camera';
import styles from './MapView.module.css';
import IncidentYearFilter from './IncidentYearFilter';
import type { IncidentYearControl } from '@/lib/incident-years';
import RiskLegend, { TrafficLegend } from './RiskLegend';
import MapAppearanceControl, {useMapAppearance} from './MapAppearanceControl';
import {mapLightPreset} from '@/lib/map-appearance';
import OfflineRoute from './OfflineRoute';
import {updateNavigationAvatarMarker,type NavigationAvatar} from '@/lib/navigation-avatar';
import CollapsiblePanel from './CollapsiblePanel';
import 'mapbox-gl/dist/mapbox-gl.css';
type Props = {
    avatar?: NavigationAvatar;
    controlsVersion?:number;
    overviewVersion?:number;
    northVersion?:number;
    incidentes?: Incidente[];
    ruta?: Ruta | null;
    onSelect?: (incidente: Incidente) => void;
    onPlaceSelect?: (place: Posicion & {nombre:string}) => void;
    onPosition?: (p: Posicion) => void | boolean;
    onLocate?: (p: LocationFix) => void;
    onRequestLocation?: () => void;
    compactLegend?: boolean;
    posicion?: Posicion | null;
    editor?: boolean;
    navigating?: boolean;
    heading?: number;
    centerVersion?: number;
    focusPoint?: { posicion: Posicion; version: number; label?: string } | null;
    onTrafficChange?: () => void;
    onBounds?: (bounds: [number, number, number, number]) => void;
    typeFilter?: { value: string; groups: IncidentFilterGroup[]; onChange: (value: string) => void };
    yearFilter?: IncidentYearControl;
};
const brandColor = (element: HTMLElement | null) => element ? getComputedStyle(element).getPropertyValue('--map-route-color').trim() || '#1554D8' : '#1554D8';
const EMPTY_INCIDENTS: Incidente[] = [];
type IncidentMarkerRecord = { marker: mapboxgl.Marker; incident: Incidente; signature: string };
export default function MapView({ incidentes = EMPTY_INCIDENTS, ruta = null, onSelect, onPlaceSelect, onPosition, onLocate, onRequestLocation, compactLegend = false, posicion = null, editor = false, typeFilter, yearFilter, navigating = false, heading, centerVersion = 0, focusPoint, onTrafficChange, onBounds,avatar='arrow',controlsVersion=0,overviewVersion=0,northVersion=0 }: Props) {
    const {appearance,change:changeAppearance}=useMapAppearance();
    const appearanceRef=useRef(appearance);
    const overviewApplied=useRef(0);
    useEffect(()=>{appearanceRef.current=appearance;},[appearance]);
    const container = useRef<HTMLDivElement>(null), mapRef = useRef<mapboxgl.Map | null>(null), markers = useRef<Map<number, IncidentMarkerRecord>>(new Map()), positionMarker = useRef<mapboxgl.Marker | null>(null);
    const callbacks = useRef({ onSelect, onPlaceSelect, onPosition, onLocate, onBounds });
    const [loaded, setLoaded] = useState(false), [risk, setRisk] = useState(true), [events, setEvents] = useState(true), [zones, setZones] = useState(true), [error, setError] = useState(''), [roads, setRoads] = useState<GeoJSON.FeatureCollection>(EMPTY_MAP_DATA), [roadError, setRoadError] = useState('');
    useEffect(()=>{
        if(!loaded)return;
        const map=mapRef.current;if(!map)return;
        const update=()=>{if(typeof map.setConfigProperty!== 'function')return;map.setConfigProperty('basemap','show3dObjects',!editor&&appearance.mode==='3d');map.setConfigProperty('basemap','lightPreset',editor?'day':mapLightPreset(appearance.light));};
        update();if(!editor)map.easeTo({pitch:appearance.mode==='3d'?55:0,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:500});
        const timer=setInterval(update,60000);return()=>clearInterval(timer);
    },[loaded,appearance,editor]);
    const geometryCache = useRef<RoadGeometry | null>(null), roadRevision = useRef('');
    const styleReady = useRef(false);
    const [controls,setControls]=useState({version:controlsVersion,open:false}), [traffic,setTraffic]=useState(false);
    const controlsOpen=controls.version===controlsVersion?controls.open:true;
    const setControlsOpen=(open:boolean)=>setControls({version:controlsVersion,open});
    const [trafficStatus, setTrafficStatus] = useState<TrafficStatus | null>(null), [trafficData, setTrafficData] = useState<TrafficResponse | null>(null), [externalSelected, setExternalSelected] = useState<ExternalTrafficIncident | null>(null);
    const [trafficError, setTrafficError] = useState('');
    const externalMarkers = useRef<mapboxgl.Marker[]>([]), trafficSnapshot = useRef(''), followCamera = useRef(true), cameraState = useRef({navigating, posicion, heading});
    const trafficCallback = useRef(onTrafficChange);
    const trafficLayerState = useRef<{enabled: boolean; url: string; bounds?: [number, number, number, number]}>({enabled: false, url: ''});
    const [trafficRevision, setTrafficRevision] = useState(0);
    const refreshTrafficRef = useRef<() => void>(() => {}), lastTrafficDiagnostic = useRef(0), lastTrafficUpdate = useRef('');
    const activeTrafficRoute = useRef(ruta);
    useEffect(() => { activeTrafficRoute.current = ruta; }, [ruta]);
    useEffect(() => { cameraState.current = {navigating, posicion, heading}; trafficCallback.current = onTrafficChange; }, [navigating, posicion, heading, onTrafficChange]);
    const filterId = useId();
    const placeMarker = useRef<mapboxgl.Marker | null>(null);
    useEffect(() => {
        const map = mapRef.current, point = focusPoint?.posicion;
        if (!loaded || !map || editor || !point || !Number.isFinite(point.latitud) || !Number.isFinite(point.longitud) || Math.abs(point.latitud) > 90 || Math.abs(point.longitud) > 180) return;
        followCamera.current = false;
        map.flyTo({ center: [point.longitud, point.latitud], zoom: Math.max(15, map.getZoom()) });
        placeMarker.current?.remove(); placeMarker.current = null;
        if(focusPoint?.label){const marker=new mapboxgl.Marker({color:'#1554d8'}).setLngLat([point.longitud,point.latitud]).addTo(map);marker.getElement().setAttribute('aria-label',focusPoint.label);placeMarker.current=marker;}
    }, [loaded, editor, focusPoint]);
    const layerState = useRef<MapLayerState>({ roads, incidents: incidentes, route: ruta, risk, events, zones, editor, brand: '#1554D8', routeOutline: '#fff' });
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    const [online, setOnline] = useState(true);
    useEffect(() => { const change = () => setOnline(navigator.onLine); window.addEventListener('online', change); window.addEventListener('offline', change); void Promise.resolve().then(change); return () => { window.removeEventListener('online', change); window.removeEventListener('offline', change); }; }, []);
    useEffect(() => { callbacks.current = { onSelect, onPlaceSelect, onPosition, onLocate, onBounds }; }, [onSelect, onPlaceSelect, onPosition, onLocate, onBounds]);
    useEffect(() => {
        layerState.current = { roads, incidents: incidentes, route: ruta, risk, events, zones, editor,
            brand: brandColor(container.current),
            routeOutline: container.current ? getComputedStyle(container.current).getPropertyValue('--map-route-outline').trim() || '#fff' : '#fff' };
        if (mapRef.current && styleReady.current) syncMapLayers(mapRef.current, layerState.current);
    }, [roads, incidentes, ruta, risk, events, zones, editor]);
    useEffect(() => {
        if (!container.current || !token)
            return;
        const map = new mapboxgl.Map({ container: container.current, accessToken: token, style: MAP_STYLE, config: {basemap: {lightPreset: "day", show3dObjects: false}}, antialias: true, center: [posicion?.longitud ?? -75.7286, posicion?.latitud ?? -14.0678], zoom: editor ? 17 : 13.3, attributionControl: true });
        const incidentMarkers = markers.current;
        mapRef.current = map;
        const resizeObserver = new ResizeObserver(() => map.resize());
        resizeObserver.observe(container.current);
        const stopMarkerZoom = bindIncidentMarkerZoom(map);
        // The main map uses wheel, pinch and keyboard gestures. Keep native
        // controls only in the report editor, where the location is confirmed.
        if (editor) {
            map.addControl(new mapboxgl.NavigationControl(), 'top-right');
            const geolocate = new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false, showUserHeading: true });
            geolocate.on('geolocate', (event: GeolocationPosition) => callbacks.current.onLocate?.({ latitud: event.coords.latitude, longitud: event.coords.longitude, accuracy: event.coords.accuracy, timestamp: event.timestamp }));
            map.addControl(geolocate, 'top-right');
        }
        const publishBounds = () => { const b = map.getBounds(); if (b) callbacks.current.onBounds?.([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]); };
        map.on('moveend', publishBounds);
        map.on('load', publishBounds);
        map.on('dragstart', () => { followCamera.current = false; });
        map.on('rotatestart', e => { if (e.originalEvent) followCamera.current = false; });
        map.on('style.load', () => {
            styleReady.current = true;
            syncMapLayers(map, layerState.current);
            if (!editor) syncTrafficLayer(map, trafficLayerState.current.enabled, trafficLayerState.current.url, trafficLayerState.current.bounds);
            setLoaded(true);
            setError('');
        });
        map.on('error', e => { if ('sourceId' in e && e.sourceId === 'tomtom-flow') {
            setTrafficError('No se pudo actualizar una parte del tráfico. Volveremos a intentarlo automáticamente.');
            if (Date.now() - lastTrafficDiagnostic.current >= 10000) { lastTrafficDiagnostic.current = Date.now(); refreshTrafficRef.current(); }
        } else if (e.error?.message?.includes('token') || e.error?.message?.includes('401') || e.error?.message?.includes('403'))
            setError('No se pudo cargar Mapbox. Revisa el token público y sus restricciones.'); });
        if (!editor) map.on('click',event=>{
            if((event.originalEvent?.target as HTMLElement)?.closest?.('.incident-marker'))return;
            const place=map.queryRenderedFeatures(event.point).find(feature=>feature.geometry.type==='Point'&&feature.layer?.type==='symbol'&&typeof(feature.properties?.name_es||feature.properties?.name)==='string');
            if(place?.geometry.type==='Point')callbacks.current.onPlaceSelect?.({nombre:String(place.properties?.name_es||place.properties?.name).slice(0,200),latitud:place.geometry.coordinates[1],longitud:place.geometry.coordinates[0]});
        });
        if (editor)
            map.on('click', e => callbacks.current.onPosition?.({ latitud: e.lngLat.lat, longitud: e.lngLat.lng }));
        return () => { resizeObserver.disconnect(); stopMarkerZoom(); styleReady.current = false; incidentMarkers.forEach(record => record.marker.remove()); incidentMarkers.clear(); externalMarkers.current.forEach(m => m.remove()); externalMarkers.current = []; positionMarker.current?.remove(); positionMarker.current = null; placeMarker.current?.remove(); placeMarker.current=null; map.remove(); mapRef.current = null; };
        // The map is initialized once. Later coordinate changes update its marker.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, editor]);
    const loadRoads = useCallback(async (signal: AbortSignal) => { if (editor) return; try {
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
        const riskData = await api<RoadRisk>('/navigation/roads/risk', { signal: requestSignal });
        let geometry = geometryCache.current;
        if (!geometry || geometry.version !== riskData.version) {
            geometry = await api<RoadGeometry>(`/navigation/roads/geometry?v=${encodeURIComponent(riskData.version)}`, { signal: requestSignal, cache: 'force-cache' });
            geometryCache.current = geometry; roadRevision.current = '';
        }
        if (!signal.aborted) {
            if (roadRevision.current !== riskData.revision) { setRoads(applyRoadRisk(geometry, riskData)); roadRevision.current = riskData.revision; }
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
        if (!events || editor) {
            markers.current.forEach(record => record.marker.remove());
            markers.current.clear();
            return;
        }
        const seen = new Set<number>();
        for (const incident of incidentes) {
            if (!Number.isFinite(incident.longitud) || !Number.isFinite(incident.latitud))
                continue;
            seen.add(incident.id);
            const level = incident.gravedad ?? incident.nivelRiesgo;
            const signature = JSON.stringify([incident.tipoSlug, incident.tipoNombre, incident.tipo, level, incident.longitud, incident.latitud]);
            const previous = markers.current.get(incident.id);
            if (previous?.signature === signature) {
                previous.incident = incident;
                continue;
            }
            previous?.marker.remove();
            const button = document.createElement('button');
            button.className = 'incident-marker';
            button.type = 'button';
            button.dataset.incidentId = String(incident.id);
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
            const marker = new mapboxgl.Marker({ element: button }).setLngLat([incident.longitud, incident.latitud]).addTo(map);
            const record = { marker, incident, signature };
            button.addEventListener('click', () => callbacks.current.onSelect?.(record.incident));
            // Mapbox assigns role="img" even to custom buttons during construction.
            button.setAttribute('role', 'button');
            markers.current.set(incident.id, record);
        }
        for (const [id, record] of markers.current) if (!seen.has(id)) { record.marker.remove(); markers.current.delete(id); }
    }, [loaded, incidentes, events, editor]);
    useEffect(() => { const map = mapRef.current; if (!loaded || !map || navigating)
        return; if (ruta?.geometria.coordinates.length) {
        const bounds = new mapboxgl.LngLatBounds();
        ruta.geometria.coordinates.forEach(c => bounds.extend([c[0], c[1]]));
        map.fitBounds(bounds, { padding: {top: 60, bottom: 100, left: 60, right: Math.min(340, Math.max(60, map.getContainer().clientWidth * .4))}, maxZoom: 16, bearing: 0, pitch: 0, duration: 700 });
    } }, [loaded, ruta, navigating]);
    useEffect(() => { const map = mapRef.current; if (!loaded || !map) return;
        if (!posicion) { positionMarker.current?.remove(); positionMarker.current = null; return; }
        if (!positionMarker.current) {
          const element=editor?undefined:document.createElement('div');if(element)element.className='web-navigation-avatar';
          positionMarker.current = new mapboxgl.Marker({ ...(element?{element}:{color:brandColor(container.current)}), draggable: editor }).setLngLat([posicion.longitud, posicion.latitud]).addTo(map);
        } else positionMarker.current.setLngLat([posicion.longitud, posicion.latitud]); if (editor) {
        positionMarker.current.off('dragend', onDrag);
        function onDrag() { const coords = positionMarker.current?.getLngLat(); if (coords) {
            const accepted = callbacks.current.onPosition?.({ latitud: coords.lat, longitud: coords.lng });
            if (accepted === false) positionMarker.current?.setLngLat([posicion!.longitud, posicion!.latitud]);
        } }
        positionMarker.current.on('dragend', onDrag);
        map.easeTo({ center: [posicion.longitud, posicion.latitud], duration: 300 });
        return () => { positionMarker.current?.off('dragend', onDrag); };
    } else if (navigating && followCamera.current) map.easeTo({center: [posicion.longitud, posicion.latitud], zoom: Math.max(16, map.getZoom()), bearing: heading ?? 0, pitch: appearanceRef.current.mode === '3d' ? 55 : 0, duration: 700}); }, [loaded, posicion, editor, navigating, heading]);
    const centerOnPosition = () => { followCamera.current = true; const map = mapRef.current, state = cameraState.current; if (map && state.posicion) map.easeTo({center: [state.posicion.longitud, state.posicion.latitud], zoom: 16.5, bearing: state.navigating ? state.heading ?? 0 : 0, pitch: appearanceRef.current.mode === '3d' ? 55 : 0, duration: 500}); };
    const restoreOrientation = () => { resetMapOrientation(mapRef.current, () => { followCamera.current = false; }); };
    useEffect(()=>{const map=mapRef.current;if(!loaded||!map||editor)return;const update=()=>{const element=positionMarker.current?.getElement();if(element)updateNavigationAvatarMarker(element,avatar,navigating,heading,map.getBearing());};update();map.on('rotate',update);return()=>{map.off('rotate',update);};},[loaded,editor,avatar,navigating,heading,posicion]);
    useEffect(()=>{const map=mapRef.current;if(!loaded||!map||!overviewVersion||overviewApplied.current===overviewVersion||!ruta?.geometria.coordinates.length)return;overviewApplied.current=overviewVersion;followCamera.current=false;const bounds=new mapboxgl.LngLatBounds();ruta.geometria.coordinates.forEach(c=>bounds.extend([c[0],c[1]]));map.fitBounds(bounds,{padding:{top:80,bottom:100,left:45,right:Math.min(350,map.getContainer().clientWidth*.4)},maxZoom:16,pitch:appearanceRef.current.mode==='3d'?45:0,bearing:0,duration:500});},[loaded,overviewVersion,ruta]);
    useEffect(()=>{if(northVersion)resetMapOrientation(mapRef.current,()=>{followCamera.current=false;});},[northVersion]);
    useEffect(() => {
        if (!navigating) return;
        followCamera.current = true;
        const map = mapRef.current, state = cameraState.current;
        if (map && state.posicion) map.easeTo({center: [state.posicion.longitud, state.posicion.latitud], zoom: 16.5, bearing: state.heading ?? 0, pitch: appearanceRef.current.mode === '3d' ? 55 : 0, duration: 500});
    }, [centerVersion, navigating]);
    const loadTraffic = useCallback(async (signal: AbortSignal) => {
        if (editor) return;
        try {
            const status = await api<TrafficStatus>('/navigation/traffic/status', {signal});
            if (signal.aborted) return; setTrafficStatus(status);
            const flowMessage = trafficFlowMessage(status), updated = status.ultimaActualizacion?.tiles ?? '';
            if (flowMessage) setTrafficError(flowMessage);
            else if (updated && updated !== lastTrafficUpdate.current) setTrafficError('');
            lastTrafficUpdate.current = updated;
            setTrafficRevision(Math.floor(Date.now() / 120000));
            const data = await api<TrafficResponse>('/navigation/traffic/incidents', {signal});
            if (signal.aborted) return; setTrafficData(data); setExternalSelected(current => current ? data.incidentes.find(i => i.id === current.id) ?? null : null);
            const currentRoute = activeTrafficRoute.current;
            const snapshot = JSON.stringify(data.incidentes.filter(i => trafficAffectsRoute(i, currentRoute, 80)).map(i => [i.id, i.tipo, i.demoraSegundos]));
            if (trafficSnapshot.current && snapshot !== trafficSnapshot.current) trafficCallback.current?.();
            trafficSnapshot.current = snapshot;
        } catch { if (!signal.aborted) setTrafficData({incidentes: [], trafico: {disponible: false, fuente: null, actualizadoEn: null, motivo: 'No se pudo actualizar el tráfico. Se mantienen disponibles los recorridos de CiviGo.'}}); }
    }, [editor]);
    const refreshTraffic = useLiveRefresh(loadTraffic, 120000);
    useEffect(() => { refreshTrafficRef.current = refreshTraffic; }, [refreshTraffic]);
    const tilesExhausted = trafficStatus?.cuotas?.tiles?.restantes === 0;
    const trafficReady = trafficStatus?.configurado && trafficStatus.habilitado && trafficStatus.controlCuotaDisponible && !tilesExhausted;
    useEffect(() => {
        trafficLayerState.current = {enabled: Boolean(traffic && trafficReady && !editor), url: `${window.location.origin}/api/navigation/traffic/tiles/flow/{z}/{x}/{y}.png?v=${trafficRevision}`, bounds: trafficStatus?.cobertura};
        const map = mapRef.current; if (!loaded || !map || editor) return;
        syncTrafficLayer(map, trafficLayerState.current.enabled, trafficLayerState.current.url, trafficLayerState.current.bounds);
    }, [loaded, traffic, trafficReady, trafficRevision, trafficStatus?.cobertura, editor]);
    useEffect(() => {
        const map = mapRef.current; externalMarkers.current.forEach(m => m.remove()); externalMarkers.current = [];
        if (!loaded || !map || !events || editor) return;
        for (const item of trafficData?.incidentes ?? []) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'incident-marker external-traffic-marker'; button.textContent = '!'; button.setAttribute('aria-label', `${item.titulo} · TomTom`); button.addEventListener('click', () => setExternalSelected(item));
            const marker = new mapboxgl.Marker({element: button}).setLngLat([item.longitud, item.latitud]).addTo(map); button.setAttribute('role', 'button'); externalMarkers.current.push(marker);
        }
    }, [loaded, trafficData, events, editor]);
    return <><div className="map-container" ref={container}/>{!online && ruta && <OfflineRoute ruta={ruta}/>}{!token && <div className="map-fallback" style={{ position: 'absolute', inset: 0 }}><MapPin size={38} color="var(--brand)"/><p>No se pudo cargar la cartografía.</p><small>Los reportes siguen disponibles en la lista. Comunícalo a la administración si el problema continúa.</small></div>}{!editor && <>
        <CollapsiblePanel title={`Capas y filtros${typeFilter?.value || yearFilter?.selected !== null && yearFilter?.selected !== undefined ? ' · filtros activos' : ''}`} className="map-controls" open={controlsOpen} onOpenChange={setControlsOpen}>
            <MapAppearanceControl value={appearance} onChange={changeAppearance}/>
            <div className="map-layer-options">
                <label><input type="checkbox" checked={risk} onChange={e => { setRisk(e.target.checked); if (e.target.checked) setTraffic(false); }}/>Riesgo por tramo</label>
                <label><input type="checkbox" checked={traffic} onChange={e => {setTraffic(e.target.checked); setTrafficError(''); if (e.target.checked) setRisk(false);}} disabled={!trafficReady}/>Tráfico · TomTom</label>
                {!trafficReady && <small className="muted">{trafficFlowMessage(trafficStatus)}</small>}
                <label><input type="checkbox" checked={events} onChange={e => setEvents(e.target.checked)}/>Incidentes</label>
                <label><input type="checkbox" checked={zones} onChange={e => setZones(e.target.checked)} disabled={!events}/>Zonas de incidentes</label>
                <small className="muted">Gris: evaluación pendiente.</small>
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
            {yearFilter && <IncidentYearFilter {...yearFilter}/>}
            <small className="muted">Los años filtran incidentes y reportes recientes. El riesgo vial conserva todos los antecedentes aplicables y el tráfico sigue siendo actual.</small>
        </CollapsiblePanel>
        {!navigating && (traffic ? <TrafficLegend compact={compactLegend}/> : <RiskLegend compact={compactLegend}/>)}
        {(posicion || onRequestLocation) && <button type="button" className="map-recenter icon-btn" aria-label={posicion ? 'Centrar mi ubicación' : 'Usar mi ubicación'} title="Mi ubicación" onClick={posicion ? centerOnPosition : onRequestLocation}><LocateFixed size={20}/></button>}
        <button type="button" data-map-control="orientation" className={`${styles.orientation} ${posicion ? styles.besidePosition : ''} icon-btn`} aria-label="Restablecer orientación" title="Restablecer orientación del mapa" onClick={restoreOrientation} disabled={!loaded}><Compass size={20}/></button>
        {traffic && trafficError && <div className="map-message notice notice-warning" role="status">{trafficError}</div>}
        {externalSelected && events && <div className="external-traffic-detail"><button className="icon-btn" aria-label="Cerrar aviso de tráfico" onClick={() => setExternalSelected(null)}>×</button><strong>{externalSelected.titulo}</strong><p>{externalSelected.descripcion}</p><small>TomTom · aviso temporal · no suma riesgo histórico</small></div>}
    </>}{(error || roadError && !editor) && <div className="map-message notice notice-warning">{error || `La capa vial no está disponible: ${roadError}`}</div>}</>;
}
