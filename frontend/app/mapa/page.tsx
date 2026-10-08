'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import MapView from '@/components/MapView';
import IncidentPanel from '@/components/IncidentPanel';
import IncidentIcon from '@/components/IncidentIcon';
import RoutePlanner from '@/components/RoutePlanner';
import CollapsiblePanel from '@/components/CollapsiblePanel';
import { useAuth } from '@/components/AuthProvider';
import { api, post, errorMessage, distance, formatDate } from '@/lib/api';
import { isHistoricalAntecedent, incidentSource } from '@/lib/incidents';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { buildIncidentFilterGroups, filterIncidentsByType } from '@/lib/incident-filters';
import type { Incidente, Ruta, Posicion, Catalogo } from '@/lib/types';
import { nearRoute, isRouteWarning } from '@/lib/navigation';
import { useNavigation } from '@/lib/use-navigation';
import BusinessDetailsDialog from '@/components/BusinessDetailsDialog';
interface Business {
    id: number;
    nombre: string;
    descripcion?: string;
    latitud: number;
    longitud: number;
    direccion?: string;
    horario?: string;
    promocion?: string;
    telefono?: string;
    sitioWeb?: string;
}
export default function Mapa() {
    const { usuario } = useAuth();
    return <AccountMap key={usuario?.id ?? 'publico'} />;
}
function AccountMap() {
    const { usuario } = useAuth();
    const [incidents, setIncidents] = useState<Incidente[]>([]), [selected, setSelected] = useState<Incidente | null>(null), [route, setRoute] = useState<Ruta | null>(null), [following, setFollowing] = useState(false), [error, setError] = useState(''), [updated, setUpdated] = useState(''), [loading, setLoading] = useState(true), [routeAlert, setRouteAlert] = useState(''), [recalculate, setRecalculate] = useState(0), [ad, setAd] = useState<Business | null>(null), [businessDetail, setBusinessDetail] = useState<Business | null>(null), [category, setCategory] = useState('');
    const [catalog, setCatalog] = useState<Catalogo | null>(null);
    const [filterLabel, setFilterLabel] = useState('');
    const changeFollowing = useCallback((value: boolean) => { setFollowing(value); setAd(null); }, []);
    const navigation = useNavigation(route, following, setRoute, changeFollowing, recalculate);
    const position = navigation.position;
    const previous = useRef<Set<number>>(new Set()), activeRoute = useRef<Ruta | null>(null), seenBusiness = useRef<Set<number>>(new Set()), traveled = useRef(150), lastTrack = useRef<Posicion | null>(null), businesses = useRef<Business[]>([]), adTimer = useRef<ReturnType<typeof setTimeout> | null>(null), trip = useRef('');
    const adConfig = useRef({anuncioMetros:50,intervaloAnuncioMetros:150,duracionAnuncioSegundos:6});
    const hasLoaded = useRef(false), lastGravity = useRef<Map<number,number|null>>(new Map()), lastSnapshot = useRef('');
    const tracking = useRef(following);
    useEffect(() => { tracking.current = following; }, [following]);
    useEffect(()=>{let ok=true;api<Catalogo>('/catalog').then(data=>{if(ok){setCatalog(data);const config=data.config;for(const key of Object.keys(adConfig.current) as (keyof typeof adConfig.current)[]){const value=Number(config[key]);if(Number.isFinite(value)&&value>0)adConfig.current[key]=value;}}}).catch(()=>{});return()=>{ok=false;};},[]);
    useEffect(() => { activeRoute.current = route; }, [route]);
    const load = useCallback(async (signal: AbortSignal) => {
        try {
        const data = await api<Incidente[]>('/incidents', {signal: AbortSignal.any([signal, AbortSignal.timeout(30000)])});
        if (signal.aborted) return;
        const newOnRoute = data.filter(i => (!previous.current.has(i.id)||((i.gravedad??i.nivelRiesgo??0)>(lastGravity.current.get(i.id)??0))) && activeRoute.current && nearRoute(i, activeRoute.current) && isRouteWarning(i));
        if (hasLoaded.current && newOnRoute.length) {
            setRouteAlert(`Hay ${newOnRoute.length} nuevo${newOnRoute.length > 1 ? 's' : ''} incidente${newOnRoute.length > 1 ? 's' : ''} importante${newOnRoute.length > 1 ? 's' : ''} cerca de tu recorrido.${tracking.current ? ' Se actualizará el recorrido desde tu ubicación.' : ' Busca recorridos para actualizar las alternativas.'}`);
            if (tracking.current) setRecalculate(v => v + 1);
        }
        previous.current = new Set(data.map(i => i.id));
        lastGravity.current = new Map(data.map(i=>[i.id,i.gravedad??i.nivelRiesgo]));
        hasLoaded.current = true;
        const snapshot = JSON.stringify(data);
        if (snapshot !== lastSnapshot.current) {
            lastSnapshot.current = snapshot;
            setIncidents(data);
            setSelected(current => current ? data.find(i => i.id === current.id) ?? null : null);
        }
        setUpdated(new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }));
        setError('');
    }
    catch (e) {
        if (!signal.aborted) setError(e instanceof Error && e.name === 'TimeoutError' ? 'La actualización está tardando demasiado. Volveremos a intentarlo automáticamente.' : errorMessage(e));
    }
    finally {
        if (!signal.aborted) setLoading(false);
    } }, []);
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
    useEffect(() => { if (!following || !position || !route || !nearRoute(position, route, 100))
        return; if (usuario?.premium && usuario.ocultarAnuncios)
        return; if (traveled.current < adConfig.current.intervaloAnuncioMetros)
        return; const close = businesses.current.filter(b => !seenBusiness.current.has(b.id) && distance(position, b) <= adConfig.current.anuncioMetros).sort((a, b) => distance(position, a) - distance(position, b))[0]; if (!close)
        return; seenBusiness.current.add(close.id); traveled.current = 0; setAd(close); void post(`/businesses/${close.id}/impressions`, { ...position, recorridoId: trip.current }).catch(() => { }); if (adTimer.current)
        clearTimeout(adTimer.current); adTimer.current = setTimeout(() => setAd(null), adConfig.current.duracionAnuncioSegundos*1000); }, [following, position, route, usuario]);
    const filtered = useMemo(() => filterIncidentsByType(incidents, category), [category, incidents]);
    const filterGroups = useMemo(() => buildIncidentFilterGroups(catalog, incidents, category ? { key: category, name: filterLabel } : undefined), [catalog, incidents, category, filterLabel]);
    const changeTypeFilter = (value: string) => {
        setCategory(value);
        setFilterLabel(filterGroups.flatMap(group => group.types).find(type => type.key === value)?.name ?? value);
    };
    return <div className="map-page">
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
                <div className="map-frame">
                    <MapView incidentes={filtered} ruta={route} onSelect={setSelected} posicion={position} navigating={following} heading={navigation.progress?.heading} centerVersion={navigation.centerVersion} onTrafficChange={() => { if (tracking.current) setRecalculate(v => v + 1); }} typeFilter={{ value: category, groups: filterGroups, onChange: changeTypeFilter }}/>
            <aside className="side-panel map-floating-panels" aria-label="Paneles del mapa">
                <CollapsiblePanel title="¿A dónde vamos?" className="map-side-panel map-route-panel" defaultOpen>
                    <RoutePlanner onRoute={setRoute} active={route} following={following} onFollow={changeFollowing} guidance={navigation}/>
                </CollapsiblePanel>
                <CollapsiblePanel title="Reportes recientes" className="map-side-panel map-reports-panel" defaultOpen>
                    <div className="card-header">
                        <span className="muted">{filtered.length} {filtered.length === 1 ? 'incidente' : 'incidentes'}{category && ' · filtro activo'}</span>
                        <button className="icon-btn" aria-label="Actualizar incidentes" onClick={refresh}><RefreshCw size={17}/></button>
                    </div>
                    {loading ? <p className="muted">Cargando incidentes…</p> : filtered.length === 0 ? <p className="muted">No hay incidentes publicados para este filtro.</p> : <div className="incident-list">
                        {filtered.map(i => <button key={i.id} className="incident-row" onClick={() => setSelected(i)}>
                            <IncidentIcon slug={i.tipoSlug} tipo={i.tipoNombre || i.tipo} />
                            <div>
                                <strong>{i.tipoNombre || i.tipo}</strong>
                                <p>{i.descripcion?.slice(0, 100) || 'Sin descripción adicional'}</p>
                                <span className="badge">Gravedad {i.gravedad ?? i.nivelRiesgo ?? 'por evaluar'}</span>
                                <span className="badge" style={{ marginLeft: 4 }}>{isHistoricalAntecedent(i) ? 'Antecedente histórico' : i.estado}</span>
                                {isHistoricalAntecedent(i) && <p className="muted">{i.fechaEvento && <>Ocurrió: {formatDate(i.fechaEvento)}<br /></>}{incidentSource(i) && <>Procedencia: {incidentSource(i)}</>}</p>}
                            </div>
                        </button>)}
                    </div>}
                </CollapsiblePanel>

            </aside>
                    <div className="map-footer"><span className="online-state"><span/>Provincia de Ica</span><span>{updated ? `Incidentes actualizados ${updated}` : 'Conectando…'}</span></div>
                </div>
            </div>
        </div>
        {error && <div className="notice notice-error" role="alert">{error}{incidents.length > 0 && ' Se conservan los últimos datos obtenidos; pueden estar desactualizados.'}</div>}
        {selected && <IncidentPanel key={selected.id} incidente={selected} onClose={() => setSelected(null)} onRefresh={refresh}/>}
        {ad && following && !(usuario?.premium && usuario.ocultarAnuncios) && <div className="business-toast">
            <div className="card-header"><span className="eyebrow" style={{ fontSize: 8 }}>RECOMENDACIÓN PATROCINADA · DEMOSTRACIÓN</span><button className="icon-btn" aria-label="Cerrar recomendación" onClick={() => setAd(null)}>×</button></div>
            <h3>{ad.nombre}</h3>
            <p className="muted" style={{ fontSize: 12 }}>{ad.promocion || ad.descripcion}</p>
            <button className="btn btn-secondary btn-small" onClick={() => { setBusinessDetail(ad); setAd(null); }}>Ver negocio</button>
        </div>}
        <BusinessDetailsDialog business={businessDetail} onClose={() => setBusinessDetail(null)} />
    </div>;
}
