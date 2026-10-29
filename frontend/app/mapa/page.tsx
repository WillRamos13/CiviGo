'use client';
import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { ChevronRight, ChevronDown, ChevronUp, LocateFixed, RefreshCw, ShieldAlert, Signal, Maximize, Minimize } from 'lucide-react';
import { useMapFullscreen } from '@/lib/use-map-fullscreen';
import styles from './page.module.css';
import MapView from '@/components/MapView';
import DestinationExplorer from '@/components/DestinationExplorer';
import {TriangleAlert} from 'lucide-react';
import IncidentPanel from '@/components/IncidentPanel';
import IncidentIcon from '@/components/IncidentIcon';
import RoutePlanner from '@/components/RoutePlanner';
import CollapsiblePanel from '@/components/CollapsiblePanel';
import { useAuth } from '@/components/AuthProvider';
import { api, post, errorMessage, distance, formatDate } from '@/lib/api';
import { isHistoricalAntecedent, incidentSource } from '@/lib/incidents';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { buildIncidentFilterGroups, filterIncidentsByType } from '@/lib/incident-filters';
import { filterIncidentsByYears, incidentYearOptions, type IncidentYears } from '@/lib/incident-years';
import type { Incidente, Ruta, Posicion, Catalogo } from '@/lib/types';
import { nearRoute, isRouteWarning } from '@/lib/navigation';
import { useNavigation } from '@/lib/use-navigation';
import {useNavigationAvatar} from '@/lib/use-navigation-avatar';
import { recentNearbyIncidents } from '@/lib/recent-incidents';
import { useMapLocation } from '@/lib/use-map-location';
import { useNearbyIncidents } from '@/lib/use-nearby-incidents';
import { ICA_MAP_BOUNDS, expandMapBounds, loadMapIncidents, mapQueryBounds, mergeMapIncidents, type MapBounds } from '@/lib/map-incidents';
import BusinessDetailsDialog from '@/components/BusinessDetailsDialog';
import NearbyBusinessCard from '@/components/NearbyBusinessCard';
interface Business {
    id: number;
    nombre: string;
    descripcion?: string;
    latitud: number;
    longitud: number;
    direccion?: string;
    horario?: string;
    promocion?: string;
    banner?:{url:string;alt?:string}|null;
    telefono?: string;
    sitioWeb?: string;
}
export default function Mapa() {
    const { usuario } = useAuth();
    return <AccountMap key={usuario?.id ?? 'publico'} />;
}
function AccountMap() {
    const { usuario } = useAuth();
    const avatar=useNavigationAvatar(usuario?.id??null);
    const [controlsVersion,setControlsVersion]=useState(0),[overviewVersion,setOverviewVersion]=useState(0),[northVersion,setNorthVersion]=useState(0);
    const [panelExpanded, setPanelExpanded] = useState(true);
    const [placeCard,setPlaceCard]=useState<(Posicion & {nombre:string})|null>(null);
    const [selectedYears, setSelectedYears] = useState<IncidentYears>(['ultimos-12-meses']);
    const routePanelId = useId();
    const pageRef = useRef<HTMLDivElement>(null);
    const mapFrameRef = useRef<HTMLDivElement>(null);
    const fullscreen = useMapFullscreen(mapFrameRef);
    useEffect(()=>{const frame=mapFrameRef.current,panel=frame?.querySelector('.map-route-panel');if(!frame||!panel)return;const update=()=>frame.style.setProperty('--route-panel-height',panel.getBoundingClientRect().height+'px');const observer=new ResizeObserver(update);observer.observe(panel);update();return()=>observer.disconnect();},[]);
    useEffect(() => {
        const viewport = window.visualViewport;
        const resize = () => pageRef.current?.style.setProperty('--map-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
        resize(); viewport?.addEventListener('resize', resize); window.addEventListener('resize', resize);
        return () => { viewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); };
    }, []);
    const [incidents, setIncidents] = useState<Incidente[]>([]), [selected, setSelected] = useState<Incidente | null>(null), [route, setRoute] = useState<Ruta | null>(null), [following, setFollowing] = useState(false), [error, setError] = useState(''), [updated, setUpdated] = useState(''), [loading, setLoading] = useState(true), [routeAlert, setRouteAlert] = useState(''), [recalculate, setRecalculate] = useState(0), [ad, setAd] = useState<Business | null>(null), [businessDetail, setBusinessDetail] = useState<Business | null>(null), [category, setCategory] = useState('');
    const [bounds, setBounds] = useState<MapBounds>(() => [...ICA_MAP_BOUNDS]);
    const [confirmedBounds, setConfirmedBounds] = useState<MapBounds | null>(null);
    const boundsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const changeBounds = useCallback((next: MapBounds) => {
        if (boundsTimer.current) clearTimeout(boundsTimer.current);
        boundsTimer.current = setTimeout(() => setBounds(previous => expandMapBounds(previous, next)), 350);
    }, []);
    useEffect(() => () => { if (boundsTimer.current) clearTimeout(boundsTimer.current); }, []);
    const [catalog, setCatalog] = useState<Catalogo | null>(null);
    const [filterLabel, setFilterLabel] = useState('');
    const [focusPoint, setFocusPoint] = useState<{ posicion: Posicion; version: number; label?: string } | null>(null);
    const focusIncident = (incident: Incidente) => setFocusPoint(current => ({ posicion: incident, version: (current?.version ?? 0) + 1 }));
    const selectIncident = (incident: Incidente) => { setSelected(incident); focusIncident(incident); };
    const changeFollowing = useCallback((value: boolean) => { setFollowing(value); setAd(null); setPanelExpanded(!value); }, []);
    const changeRoute = useCallback((next: Ruta | null) => {
        setRoute(next);
        setBounds(previous => mapQueryBounds(previous, next?.geometria.coordinates));
    }, []);
    const navigation = useNavigation(route, following, changeRoute, changeFollowing, recalculate);
    const location = useMapLocation(navigation.position, following);
    const position = location.position;
    const nearby = useNearbyIncidents(position, category);
    const previous = useRef<Set<number>>(new Set()), activeRoute = useRef<Ruta | null>(null), seenBusiness = useRef<Set<number>>(new Set()), traveled = useRef(150), lastTrack = useRef<Posicion | null>(null), businesses = useRef<Business[]>([]), adTimer = useRef<ReturnType<typeof setTimeout> | null>(null), trip = useRef('');
    const adConfig = useRef({anuncioMetros:50,intervaloAnuncioMetros:150,duracionAnuncioSegundos:6});
    const hasLoaded = useRef(false), lastGravity = useRef<Map<number,number|null>>(new Map()), lastSnapshot = useRef('');
    const tracking = useRef(following);
    useEffect(() => { tracking.current = following; }, [following]);
    useEffect(()=>{let ok=true;api<Catalogo>('/catalog').then(data=>{if(ok){setCatalog(data);const config=data.config;for(const key of Object.keys(adConfig.current) as (keyof typeof adConfig.current)[]){const value=Number(config[key]);if(Number.isFinite(value)&&value>0)adConfig.current[key]=value;}}}).catch(()=>{});return()=>{ok=false;};},[]);
    useEffect(() => { activeRoute.current = route; }, [route]);
    const load = useCallback(async (signal: AbortSignal) => {
        try {
        const area = mapQueryBounds(bounds, activeRoute.current?.geometria.coordinates);
        const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
        const data = await loadMapIncidents(area, path => api(path, { signal: requestSignal }), requestSignal);
        if (signal.aborted) return;
        const newOnRoute = data.filter(i => (!previous.current.has(i.id)||((i.gravedad??i.nivelRiesgo??0)>(lastGravity.current.get(i.id)??0))) && activeRoute.current && nearRoute(i, activeRoute.current) && isRouteWarning(i));
        if (hasLoaded.current && newOnRoute.length) {
            setRouteAlert(`Hay ${newOnRoute.length} nuevo${newOnRoute.length > 1 ? 's' : ''} incidente${newOnRoute.length > 1 ? 's' : ''} importante${newOnRoute.length > 1 ? 's' : ''} cerca de tu recorrido.${tracking.current ? ' Se actualizará el recorrido desde tu ubicación.' : ' Busca recorridos para actualizar las alternativas.'}`);
            if (tracking.current) setRecalculate(v => v + 1);
        }
        const previousIds = previous.current;
        previous.current = new Set(data.map(i => i.id));
        lastGravity.current = new Map(data.map(i=>[i.id,i.gravedad??i.nivelRiesgo]));
        hasLoaded.current = true;
        setConfirmedBounds(current => current && current.every((coordinate, index) => coordinate === area[index]) ? current : area);
        const snapshot = JSON.stringify(data);
        if (snapshot !== lastSnapshot.current) {
            lastSnapshot.current = snapshot;
            setIncidents(data);
            setSelected(current => current ? data.find(i => i.id === current.id) ?? (previousIds.has(current.id) ? null : current) : null);
        }
        setUpdated(new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }));
        setError('');
    }
    catch (e) {
        if (!signal.aborted) setError(e instanceof Error && e.name === 'TimeoutError' ? 'La actualización está tardando demasiado. Volveremos a intentarlo automáticamente.' : errorMessage(e));
    }
    finally {
        if (!signal.aborted) setLoading(false);
    } }, [bounds]);
    const refresh = useLiveRefresh(load);
    useEffect(() => {
        if (!following) return;
        let current = true;
        businesses.current = []; seenBusiness.current = new Set(); traveled.current = adConfig.current.intervaloAnuncioMetros; lastTrack.current = null; trip.current = crypto.randomUUID();
        const controller = new AbortController();
        api<Business[]>('/businesses', {signal: controller.signal}).then(data => { if (current) businesses.current = data; }).catch(() => {});
        return () => { current = false; controller.abort(); businesses.current = []; if (adTimer.current) clearTimeout(adTimer.current); };
    }, [following]);
    useEffect(() => { if (!following || !position || (position.accuracy ?? 0) > 60) return; if (lastTrack.current) { const step = distance(position, lastTrack.current); if (step > 2 && step < 500) traveled.current += step; } lastTrack.current = position; }, [following, position]);
    useEffect(() => { if (!following || !position || (position.accuracy??Infinity)>60 || !route || !nearRoute(position, route, 100))
        return; if (usuario?.premium && usuario.ocultarAnuncios)
        return; if (traveled.current < adConfig.current.intervaloAnuncioMetros)
        return; const close = businesses.current.filter(b => !seenBusiness.current.has(b.id) && distance(position, b) <= adConfig.current.anuncioMetros).sort((a, b) => distance(position, a) - distance(position, b))[0]; if (!close)
        return; seenBusiness.current.add(close.id); traveled.current = 0; setAd(close); void post(`/businesses/${close.id}/impressions`, { ...position, recorridoId: trip.current }).catch(() => { }); if (adTimer.current)
        clearTimeout(adTimer.current); adTimer.current = setTimeout(() => setAd(null), Math.max(15,adConfig.current.duracionAnuncioSegundos)*1000); }, [following, position, route, usuario]);
    const observed = useMemo(() => mergeMapIncidents(incidents, nearby.incidents, confirmedBounds), [incidents, nearby.incidents, confirmedBounds]);
    const years = useMemo(() => incidentYearOptions(observed, selectedYears), [observed, selectedYears]);
    const filtered = useMemo(() => filterIncidentsByYears(filterIncidentsByType(observed, category), selectedYears), [category, observed, selectedYears]);
    const recent = useMemo(() => recentNearbyIncidents(filterIncidentsByYears(filterIncidentsByType(selectedYears === null ? nearby.incidents : observed, category), selectedYears), position), [category, nearby.incidents, observed, position, selectedYears]);
    const refreshAll = () => { refresh(); nearby.refresh(); };
    const filterGroups = useMemo(() => buildIncidentFilterGroups(catalog, observed, category ? { key: category, name: filterLabel } : undefined), [catalog, observed, category, filterLabel]);
    const changeTypeFilter = (value: string) => {
        setCategory(value);
        setFilterLabel(filterGroups.flatMap(group => group.types).find(type => type.key === value)?.name ?? value);
    };
    return <div ref={pageRef} className={`map-page ${styles.page} ${following ? styles.navigating : ''}`} data-map-mode={following ? 'navigation' : 'planning'}>
        <h1 className="sr-only">Mapa de incidentes en Ica</h1>
        {routeAlert && <div className="notice notice-warning">
            <strong><ShieldAlert size={16} style={{ display: 'inline', marginRight: 8 }}/>Aviso sobre tu recorrido</strong>
            <p style={{ margin: '7px 0' }}>{routeAlert}</p>
            <div className="actions">
                <button className="btn btn-secondary btn-small" onClick={() => setRouteAlert('')}>Cerrar aviso</button>
            </div>
        </div>}
        {!following && navigation.notice && <div className="notice notice-warning">{navigation.notice}</div>}
        <div className="map-workspace">
            <div className="map-column">
                <div ref={mapFrameRef} className={`map-frame ${fullscreen.active?styles.fullscreenFrame:''}`} data-map-fullscreen={fullscreen.active} aria-busy={loading}>
                    <button type="button" className={`icon-btn ${styles.fullscreenButton}`} aria-label={fullscreen.active?'Salir de pantalla completa':'Ampliar mapa a pantalla completa'} aria-pressed={fullscreen.active} onClick={()=>void fullscreen.toggle()}>{fullscreen.active?<Minimize size={20}/>:<Maximize size={20}/>}</button>
                    {fullscreen.notice&&<span role="status" className="sr-only">{fullscreen.notice}</span>}
                    <MapView onPlaceSelect={setPlaceCard} avatar={avatar.avatar} controlsVersion={controlsVersion} overviewVersion={overviewVersion} northVersion={northVersion} onBounds={changeBounds} incidentes={filtered} ruta={route} onSelect={selectIncident} focusPoint={focusPoint} posicion={position} onLocate={location.acceptPosition} onRequestLocation={location.requestLocation} compactLegend navigating={following} heading={navigation.progress?.heading} centerVersion={navigation.centerVersion} onTrafficChange={() => { if (tracking.current) setRecalculate(v => v + 1); }} yearFilter={{options: years, selected: selectedYears, onChange: value => {setSelectedYears(value); setSelected(null);}}} typeFilter={{ value: category, groups: filterGroups, onChange: changeTypeFilter }}/>
                    <section className={`map-side-panel map-route-panel ${styles.plannerPanel}`} aria-label="Panel de recorridos" data-expanded={panelExpanded}>
                        {following && <button type="button" className={`panel-toggle ${styles.plannerToggle}`} aria-expanded={panelExpanded} aria-controls={routePanelId} onClick={() => setPanelExpanded(value => !value)}>
                            <strong>{following ? 'EN CAMINO' : '¿A DÓNDE VAMOS?'}</strong>
                            {!following && <span className={styles.incidentCount}>{filtered.length} en mapa</span>}
                            {panelExpanded ? <ChevronDown size={17} aria-hidden="true"/> : <ChevronUp size={17} aria-hidden="true"/>}
                        </button>}
                        <div id={routePanelId} className={`collapsible-panel-body ${styles.plannerBody}`} hidden={false}>
                            <RoutePlanner onShowPlace={place=>{setSelected(null);setFocusPoint(current=>({posicion:place,label:place.nombre,version:(current?.version??0)+1}));setPanelExpanded(false);}} onRoute={changeRoute} active={route} following={following} onFollow={changeFollowing} guidance={{...navigation,avatar:avatar.avatar,onAvatarChange:avatar.change,avatarNotice:avatar.notice,onLayers:()=>setControlsVersion(v=>v+1),onOverview:()=>setOverviewVersion(v=>v+1),onNorth:()=>setNorthVersion(v=>v+1)}} onLocate={location.acceptPosition} currentPosition={position} compact={following && !panelExpanded}/>
                        </div>
                    </section>
                    {following && <a className={styles.reportControl} href="/reportar" target="_blank" rel="noopener noreferrer" aria-label="Reportar incidente" title="Reportar incidente"><TriangleAlert size={20}/></a>}
                    <DestinationExplorer open={!!placeCard} initialPlace={placeCard} ownerId={usuario?.id??null} currentPosition={position} route={route} onClose={()=>setPlaceCard(null)} onChoose={place=>{window.dispatchEvent(new CustomEvent('civigo:choose-place',{detail:place}));setPanelExpanded(true);}} onShowPlace={place=>setFocusPoint(current=>({posicion:place,label:place.nombre,version:(current?.version??0)+1}))}/>
                    {selected && <IncidentPanel key={selected.id} incidente={selected} variant="map-card" onClose={() => setSelected(null)} onRefresh={refreshAll} onShowOnMap={() => { focusIncident(selected); setSelected(null); if (!fullscreen.active) document.querySelector('.map-column')?.scrollIntoView({block: 'start'}); }}/>}
                </div>
                <div className="map-footer"><span className="online-state"><span/>Provincia de Ica</span><span>{updated ? `Actualizados ${updated}` : 'Conectando…'}</span><Signal size={17} aria-hidden="true"/></div>
            </div>
                <CollapsiblePanel title="Reportes recientes" className="map-side-panel map-reports-panel" defaultOpen>
                    <div className="card-header">
                        <span className="muted">{recent.length} {recent.length === 1 ? 'reporte' : 'reportes'} · a 1 km de ti{(category || selectedYears !== null) && ' · filtro activo'}</span>
                        <button className="icon-btn" aria-label="Actualizar incidentes" onClick={refreshAll}><RefreshCw size={17}/></button>
                    </div>
                    {position && location.error && <p className="notice notice-warning" role="status">{location.error}</p>}
                    {!position ? <div className="nearby-location-notice" role="status">
                        <p>{location.status === 'locating' ? 'Buscando tu ubicación…' : location.error || 'Activa tu ubicación para ver los últimos 10 reportes dentro de 1 km de ti.'}</p>
                        <button className="btn btn-secondary btn-small" disabled={location.status === 'locating'} onClick={location.requestLocation}><LocateFixed size={15}/>Usar mi ubicación</button>
                    </div> : nearby.loading ? <p className="muted">Cargando reportes cercanos…</p> : recent.length === 0 ? <p className="muted">{nearby.error || 'No hay incidentes publicados para este filtro a menos de 1 km de tu ubicación.'}</p> : <div className="incident-list">
                        {recent.map(i => <button key={i.id} className="incident-row" onClick={() => selectIncident(i)}>
                            <IncidentIcon slug={i.tipoSlug} tipo={i.tipoNombre || i.tipo} />
                            <div className="recent-incident-copy">
                                <strong>{i.tipoNombre || i.tipo}</strong>
                                <p>{i.descripcion?.slice(0, 100) || 'Sin descripción adicional'}</p>
                                {isHistoricalAntecedent(i) && <p className="muted">{i.fechaEvento && <>Ocurrió: {formatDate(i.fechaEvento)}<br /></>}{incidentSource(i) && <>Procedencia: {incidentSource(i)}</>}</p>}
                            </div>
                            <div className="recent-incident-badges"><span className="badge">Gravedad {i.gravedad ?? i.nivelRiesgo ?? 'por evaluar'}</span><span className="badge recent-incident-state">{isHistoricalAntecedent(i) ? 'Histórico' : i.estado}</span></div>
                            <ChevronRight size={18} className="recent-incident-arrow" aria-hidden="true"/>
                        </button>)}
                    </div>}
                    {position && recent.length > 0 && nearby.error && <p className="muted" role="status">No se pudieron actualizar los reportes cercanos. Los últimos datos pueden estar desactualizados.</p>}
                </CollapsiblePanel>

        </div>
        {error && <div className="notice notice-error" role="alert">{error}{incidents.length > 0 && ' Se conservan los últimos datos obtenidos; pueden estar desactualizados.'}</div>}
        {ad && following && !(usuario?.premium && usuario.ocultarAnuncios) && <NearbyBusinessCard key={ad.id} business={ad} onInteract={()=>{if(adTimer.current)clearTimeout(adTimer.current);}} onClose={()=>setAd(null)} onDetails={()=>{setBusinessDetail(ad);setAd(null);}}/>}
        <BusinessDetailsDialog business={businessDetail} onClose={() => setBusinessDetail(null)} />
    </div>;
}
