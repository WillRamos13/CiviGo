'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { MapPin, RefreshCw, ShieldAlert } from 'lucide-react';
import MapView from '@/components/MapView';
import IncidentPanel from '@/components/IncidentPanel';
import IncidentIcon from '@/components/IncidentIcon';
import RoutePlanner from '@/components/RoutePlanner';
import { useAuth } from '@/components/AuthProvider';
import { api, post, errorMessage, distance, formatDate } from '@/lib/api';
import { isHistoricalAntecedent, incidentSource } from '@/lib/incidents';
import type { Incidente, Ruta, Posicion, Catalogo } from '@/lib/types';
import { nearRoute, isRouteWarning, watchRoutePosition } from '@/lib/navigation';
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
function safeWebsite(value?: string) {
    if (!value) return null;
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export default function Mapa() {
    const { usuario } = useAuth();
    return <AccountMap key={usuario?.id ?? 'publico'} />;
}
function AccountMap() {
    const { usuario } = useAuth();
    const [incidents, setIncidents] = useState<Incidente[]>([]), [selected, setSelected] = useState<Incidente | null>(null), [route, setRoute] = useState<Ruta | null>(null), [following, setFollowing] = useState(false), [error, setError] = useState(''), [updated, setUpdated] = useState(''), [loading, setLoading] = useState(true), [routeAlert, setRouteAlert] = useState(''), [recalculate, setRecalculate] = useState(0), [position, setPosition] = useState<Posicion | null>(null), [ad, setAd] = useState<Business | null>(null), [businessDetail, setBusinessDetail] = useState<Business | null>(null), [adMessage, setAdMessage] = useState(''), [category, setCategory] = useState('');
    const businessWebsite = safeWebsite(businessDetail?.sitioWeb);
    const changeFollowing = useCallback((value: boolean) => { setFollowing(value); setAd(null); if (value) { setPosition(null); setAdMessage(''); } }, []);
    const previous = useRef<Set<number>>(new Set()), activeRoute = useRef<Ruta | null>(null), seenBusiness = useRef<Set<number>>(new Set()), traveled = useRef(150), lastTrack = useRef<Posicion | null>(null), businesses = useRef<Business[]>([]), adTimer = useRef<ReturnType<typeof setTimeout> | null>(null), trip = useRef('');
    const adConfig = useRef({anuncioMetros:50,intervaloAnuncioMetros:150,duracionAnuncioSegundos:6});
    const hasLoaded = useRef(false), lastGravity = useRef<Map<number,number|null>>(new Map()), loadRequest = useRef<AbortController | null>(null);
    useEffect(()=>{let ok=true;api<Catalogo>('/catalog').then(data=>{if(ok){const config=data.config;for(const key of Object.keys(adConfig.current) as (keyof typeof adConfig.current)[]){const value=Number(config[key]);if(Number.isFinite(value)&&value>0)adConfig.current[key]=value;}}}).catch(()=>{});return()=>{ok=false;};},[]);
    useEffect(() => { activeRoute.current = route; }, [route]);
    const load = useCallback(async () => {
        loadRequest.current?.abort();
        const controller = new AbortController(); loadRequest.current = controller;
        try {
        const data = await api<Incidente[]>('/incidents', {signal: controller.signal});
        if (controller.signal.aborted) return;
        const newOnRoute = data.filter(i => (!previous.current.has(i.id)||((i.gravedad??i.nivelRiesgo??0)>(lastGravity.current.get(i.id)??0))) && activeRoute.current && nearRoute(i, activeRoute.current) && isRouteWarning(i));
        if (hasLoaded.current && newOnRoute.length)
            setRouteAlert(`Hay ${newOnRoute.length} nuevo${newOnRoute.length > 1 ? 's' : ''} incidente${newOnRoute.length > 1 ? 's' : ''} importante${newOnRoute.length > 1 ? 's' : ''} cerca de tu recorrido. Puedes mantenerlo o buscar otra alternativa.`);
        previous.current = new Set(data.map(i => i.id));
        lastGravity.current = new Map(data.map(i=>[i.id,i.gravedad??i.nivelRiesgo]));
        hasLoaded.current = true;
        setIncidents(data);
        setUpdated(new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }));
        setError('');
    }
    catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e));
    }
    finally {
        if (!controller.signal.aborted) setLoading(false);
    } }, []);
    useEffect(() => { void load(); const timer = setInterval(load, 20000); return () => { clearInterval(timer); loadRequest.current?.abort(); }; }, [load]);
    useEffect(() => {
        if (!following || !route) return;
        let current = true;
        businesses.current = []; seenBusiness.current = new Set(); traveled.current = adConfig.current.intervaloAnuncioMetros; lastTrack.current = null; trip.current = crypto.randomUUID();
        const stop = watchRoutePosition(navigator.geolocation, next => {
            if (!current) return;
            if (lastTrack.current) { const step = distance(next, lastTrack.current); if (step > 2 && step < 500) traveled.current += step; }
            lastTrack.current = next; setPosition(next);
        }, message => { if (current) { setFollowing(false); setPosition(null); setAdMessage(message); } });
        const controller = new AbortController();
        api<Business[]>('/businesses', {signal: controller.signal}).then(data => { if (current) businesses.current = data; }).catch(() => {});
        return () => { current = false; stop(); controller.abort(); businesses.current = []; if (adTimer.current) clearTimeout(adTimer.current); };
    }, [following, route]);
    useEffect(() => { if (!following || !position || !route || !nearRoute(position, route, 100))
        return; if (usuario?.premium && usuario.ocultarAnuncios)
        return; if (traveled.current < adConfig.current.intervaloAnuncioMetros)
        return; const close = businesses.current.filter(b => !seenBusiness.current.has(b.id) && distance(position, b) <= adConfig.current.anuncioMetros).sort((a, b) => distance(position, a) - distance(position, b))[0]; if (!close)
        return; seenBusiness.current.add(close.id); traveled.current = 0; setAd(close); void post(`/businesses/${close.id}/impressions`, { ...position, recorridoId: trip.current }).catch(() => { }); if (adTimer.current)
        clearTimeout(adTimer.current); adTimer.current = setTimeout(() => setAd(null), adConfig.current.duracionAnuncioSegundos*1000); }, [following, position, route, usuario]);
    const filtered = category ? incidents.filter(i => (i.tipoNombre || i.tipo) === category) : incidents;
    return <div className="map-page"><div className="map-heading"><div><span className="eyebrow">EXPLORA TU ENTORNO</span><h1 style={{ marginTop: 8 }}>Ica, desde una nueva perspectiva.</h1><p>Reportes ciudadanos y recorridos informados, en un solo lugar.</p></div><Link className="btn btn-primary" href="/reportar"><MapPin size={16}/>Reportar incidente</Link></div>{routeAlert && <div className="notice notice-warning"><strong><ShieldAlert size={16} style={{ display: 'inline', marginRight: 8 }}/>Aviso sobre tu recorrido</strong><p style={{ margin: '7px 0' }}>{routeAlert}</p><div className="actions"><button className="btn btn-primary btn-small" onClick={() => { setRecalculate(recalculate + 1); setRouteAlert(''); setFollowing(false); }}>Buscar alternativas</button><button className="btn btn-secondary btn-small" onClick={() => setRouteAlert('')}>Mantener recorrido</button></div></div>}{adMessage && <div className="notice notice-warning">{adMessage}</div>}<div className="map-workspace"><div className="map-column"><div className="map-frame"><MapView incidentes={filtered} ruta={route} onSelect={setSelected} posicion={position}/></div><div className="map-footer"><span className="online-state"><span /> Provincia de Ica · Cobertura inicial</span><span>{updated ? `Incidentes actualizados ${updated}` : 'Conectando…'}</span></div><div className="notice" style={{ fontSize: 11 }}>El color describe los puntos registrados en cada tramo. Los incidentes por evaluar aparecen con «?». Fuera de cobertura no se dispone de información.</div><div className="card"><div className="card-header"><h2>Lo que pasa en tu ciudad</h2><button className="icon-btn" aria-label="Actualizar incidentes" onClick={load}><RefreshCw size={17}/></button></div>{error && <div className="notice notice-error" role="alert">{error}{incidents.length > 0 && ' Se conservan los últimos datos obtenidos; pueden estar desactualizados.'}</div>}<div className="field"><label htmlFor="filter-type">Filtrar incidentes</label><select id="filter-type" value={category} onChange={e => setCategory(e.target.value)}><option value="">Todos los tipos</option>{Array.from(new Set(incidents.map(i => i.tipoNombre || i.tipo))).sort().map(t => <option key={t}>{t}</option>)}</select></div>{loading ? <p className="muted">Cargando incidentes…</p> : filtered.length === 0 ? <p className="muted">No hay incidentes publicados para este filtro.</p> : <div className="grid-2">{filtered.map(i => <button key={i.id} className="incident-row" onClick={() => setSelected(i)}><IncidentIcon slug={i.tipoSlug} tipo={i.tipoNombre || i.tipo} /><div><strong>{i.tipoNombre || i.tipo}</strong><p>{i.descripcion?.slice(0, 100) || 'Sin descripción adicional'}</p><span className="badge">Gravedad {i.gravedad ?? i.nivelRiesgo ?? 'por evaluar'}</span><span className="badge" style={{ marginLeft: 4 }}>{isHistoricalAntecedent(i) ? 'Antecedente histórico' : i.estado}</span>{isHistoricalAntecedent(i) && <p className="muted">{i.fechaEvento && <>Ocurrió: {formatDate(i.fechaEvento)}<br /></>}{incidentSource(i) && <>Procedencia: {incidentSource(i)}</>}</p>}</div></button>)}</div>}</div></div><aside className="side-panel"><RoutePlanner onRoute={setRoute} active={route} following={following} onFollow={changeFollowing} recalculate={recalculate}/><div className="card"><h2>Una comunidad que se cuida</h2><p className="muted" style={{ fontSize: 12 }}>Comparte información útil. Confirma solo lo que observas y deja la revisión de pruebas privadas a los agentes.</p><Link href="/ranking" className="btn btn-secondary btn-small">Conocer la comunidad →</Link>{!(usuario?.premium && usuario.ocultarAnuncios) && <div className="ad-space"><span className="eyebrow" style={{ fontSize: 8 }}>PUBLICIDAD · DEMOSTRACIÓN</span><p style={{ margin: '8px 0 0' }}>Espacio para convenios locales. No se realizan cobros ni se inventan anunciantes.</p></div>}</div></aside></div>{selected && <IncidentPanel key={selected.id} incidente={selected} onClose={() => setSelected(null)} onRefresh={load}/>} {ad && following && !(usuario?.premium && usuario.ocultarAnuncios) && <div className="business-toast"><div className="card-header"><span className="eyebrow" style={{ fontSize: 8 }}>RECOMENDACIÓN PATROCINADA · DEMOSTRACIÓN</span><button className="icon-btn" aria-label="Cerrar recomendación" onClick={() => setAd(null)}>×</button></div><h3>{ad.nombre}</h3><p className="muted" style={{ fontSize: 12 }}>{ad.promocion || ad.descripcion}</p><button className="btn btn-secondary btn-small" onClick={() => { setBusinessDetail(ad); setAd(null); }}>Ver negocio</button></div>}{businessDetail && <div className="modal-backdrop" onClick={() => setBusinessDetail(null)}><section className="modal-panel" role="dialog" aria-modal="true" aria-label="Ficha del negocio" onClick={e => e.stopPropagation()}><div className="card-header"><h2>{businessDetail.nombre}</h2><button className="icon-btn" onClick={() => setBusinessDetail(null)} aria-label="Cerrar ficha">×</button></div><div className="card"><span className="badge">Negocio participante · Demostración</span><p style={{ marginTop: 15 }}>{businessDetail.descripcion}</p><p><strong>Dirección:</strong> {businessDetail.direccion || 'No indicada'}</p><p><strong>Horario:</strong> {businessDetail.horario || 'No indicado'}</p>{businessDetail.promocion && <div className="notice">{businessDetail.promocion}</div>}{businessDetail.telefono && <p><strong>Contacto:</strong> {businessDetail.telefono}</p>}{businessWebsite && <p><a href={businessWebsite} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-small">Visitar sitio del negocio ↗</a></p>}</div></section></div>}</div>;
}
