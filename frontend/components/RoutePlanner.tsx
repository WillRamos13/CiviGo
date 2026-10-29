'use client';
import Link from 'next/link';
import CiviDroid, { CiviDroidLauncher } from './CiviDroid';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Footprints, Bike, Car, MapPin, Bookmark, Navigation, Square, ArrowLeft, X, Search, ShieldCheck, Timer, Scale, ChevronRight, Check, AlertTriangle } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { api, post, currentPosition as requestPosition, errorMessage, formatDate } from '@/lib/api';
import type { Posicion, Ruta } from '@/lib/types';
import { RISK_COLORS, RISK_NAMES } from '@/lib/types';
import { readRouteCache, isPosition, isRoute, routeMode, type CachedRoute } from '@/lib/route-cache';
import PlaceInput from './PlaceInput';
import DestinationExplorer from './DestinationExplorer';
import NavigationGuidance, {type GuidanceProps} from './NavigationGuidance';
import styles from './RoutePlanner.module.css';
import { routeTimeSource } from '@/lib/navigation-presentation';
import { formatDuration } from '@/lib/duration';
type Punto = Posicion & { nombre: string };
type Saved = { id: number; nombre: string; modo: string; origen: Posicion; destino: Posicion; datos: Ruta; creadoEn: string };
type Props = { onRoute: (r: Ruta | null) => void; active: Ruta | null; following: boolean; onFollow: (v: boolean) => void; recalculate?: number; guidance?: GuidanceProps; onLocate?: (position: Posicion) => void; currentPosition?: Posicion | null; compact?: boolean; onShowPlace?: (place: Punto) => void };
export default function RoutePlanner(props: Props) {
    const { usuario } = useAuth();
    return <AccountRoutePlanner key={usuario?.id ?? 'publico'} {...props} />;
}
function AccountRoutePlanner({ onRoute, active, following, onFollow, recalculate = 0, guidance, onLocate, currentPosition, compact = false, onShowPlace }: Props) {
    const { usuario, offline } = useAuth();
    const accountId = usuario?.id, premium = usuario?.premium === true;
    const [origin, setOrigin] = useState<Punto | null>(null), [destination, setDestination] = useState<Punto | null>(null), [mode, setMode] = useState('walking'), [routes, setRoutes] = useState<Ruta[]>([]), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [manual, setManual] = useState(false), [cached, setCached] = useState<CachedRoute[]>([]), [saved, setSaved] = useState<Saved[]>([]), [favoriteName, setFavoriteName] = useState(''), [favoriteTags, setFavoriteTags] = useState(''), [loadedCopy, setLoadedCopy] = useState(false);
    const [manualOrigin, setManualOrigin] = useState(['', '']), [manualDestination, setManualDestination] = useState(['', '']);
    const [step, setStep] = useState<'idle' | 'destination' | 'origin' | 'transport' | 'routes'>('idle');
    const wizardRef = useRef<HTMLDivElement>(null);
    useEffect(() => { const scroller = wizardRef.current?.closest<HTMLElement>('.collapsible-panel-body'); if(scroller) scroller.scrollTop = 0; }, [step]);
    const [explorer, setExplorer] = useState({open:false,query:''});
    const [locating, setLocating] = useState(false);
    const originTouched = useRef(false), gpsSeeded = useRef(false);
    const mounted = useRef(true), planEpoch = useRef(0), selectionEpoch = useRef(0), planRequest = useRef<AbortController | null>(null), requests = useRef(new Set<AbortController>());
    const cleanupRequests = useCallback(() => { mounted.current = false; planEpoch.current++; selectionEpoch.current++; requests.current.forEach(c => c.abort()); requests.current.clear(); }, []);
    useEffect(() => { mounted.current = true; return cleanupRequests; }, [cleanupRequests]);
    const newRequest = () => { const controller = new AbortController(); requests.current.add(controller); return controller; };
    const invalidate = useCallback(() => { planEpoch.current++; selectionEpoch.current++; planRequest.current?.abort(); setRoutes([]); setBusy(false); setMessage(''); setError(''); setLoadedCopy(false); onRoute(null); onFollow(false); },[onRoute,onFollow]);
    const changeOrigin = (value: Punto | null) => { originTouched.current = true; invalidate(); setOrigin(value); setManualOrigin(value ? [String(value.latitud), String(value.longitud)] : ['', '']); };
    const changeDestination = useCallback((value: Punto | null) => { invalidate(); setDestination(value); setManualDestination(value ? [String(value.latitud), String(value.longitud)] : ['', '']); setStep(origin ? 'transport' : 'origin'); },[invalidate, origin]);
    const changeManual = (isOrigin: boolean, axis: number, text: string) => {
        if (isOrigin) originTouched.current = true;
        const values = [...isOrigin ? manualOrigin : manualDestination]; values[axis] = text;
        (isOrigin ? setManualOrigin : setManualDestination)(values);
        const point = {latitud: Number(values[0]), longitud: Number(values[1]), nombre: isOrigin ? 'Origen' : 'Destino'};
        invalidate(); (isOrigin ? setOrigin : setDestination)(values.every(v => v.trim()) && isPosition(point) ? point : null);
    };
    useEffect(() => {
        if (gpsSeeded.current || originTouched.current || origin || !isPosition(currentPosition)) return;
        const point = { ...currentPosition, nombre: 'Mi ubicación actual' };
        void Promise.resolve().then(() => {
            if (!mounted.current || originTouched.current || gpsSeeded.current) return;
            gpsSeeded.current = true; setOrigin(point); setManualOrigin([String(point.latitud), String(point.longitud)]);
        });
    }, [currentPosition, origin]);
    useEffect(() => {
        if (!accountId) return;
        let current = true;
        const controller = new AbortController();
        void Promise.resolve().then(() => {
            if (!current) return;
            setCached(readRouteCache({getItem: key => window.localStorage.getItem(key)}, accountId, premium));
            setSaved([]);
        });
        if (!offline) api<Saved[]>('/navigation/favorites', {signal: controller.signal}).then(data => {
            if (current) setSaved(data.filter(item => isRoute(item.datos) && isPosition(item.origen) && isPosition(item.destino)));
        }).catch(() => {});
        return () => { current = false; controller.abort(); };
    }, [accountId, premium, offline]);
    const plan = async (selectedMode = mode) => {
        if (!isPosition(origin) || !isPosition(destination)) return setError('Selecciona un origen y destino con coordenadas válidas.');
        if (offline) return setError('Para actualizar las condiciones del recorrido necesitas conexión. Puedes consultar tus copias guardadas.');
        setStep('routes');
        planRequest.current?.abort();
        const controller = newRequest(), epoch = ++planEpoch.current;
        planRequest.current = controller;
        setBusy(true); setError(''); setMessage(''); setRoutes([]); setLoadedCopy(false); onFollow(false); onRoute(null);
        try {
            const data = await post<{rutas: Ruta[]}>('/navigation/plan', {origen: origin, destino: destination, modo: selectedMode}, {signal: controller.signal});
            if (!mounted.current || epoch !== planEpoch.current) return;
            if (!Array.isArray(data.rutas) || !data.rutas.every(isRoute)) throw new Error('El servicio devolvió recorridos incompletos. Inténtalo de nuevo.');
            setRoutes(data.rutas);
            if (!data.rutas.length) setMessage('No se encontraron alternativas disponibles para este recorrido.');
        } catch (e) { if (mounted.current && epoch === planEpoch.current && !controller.signal.aborted) setError(errorMessage(e)); }
        finally { requests.current.delete(controller); if (mounted.current && epoch === planEpoch.current) setBusy(false); }
    };
    useEffect(() => {
        if (recalculate > 0) void Promise.resolve().then(()=>plan());
        // Recalculation is explicitly triggered by the route alert button.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recalculate]);
    const select = async (r: Ruta) => {
        if (!usuario || !isRoute(r)) return;
        const selection = ++selectionEpoch.current;
        onRoute({...r, modo: routeMode(mode), origen: origin ?? undefined, destino: destination ?? undefined}); onFollow(false); setMessage(''); setLoadedCopy(offline);
        const cache = [{ruta: r, fecha: new Date().toISOString(), origen: origin, destino: destination, modo: routeMode(mode)}, ...cached.filter(c => c.ruta.id !== r.id)].slice(0, usuario.premium ? 20 : 1);
        setCached(cache);
        try { localStorage.setItem(`civigo:rutas:${usuario.id}`, JSON.stringify(cache)); }
        catch { setMessage('No se pudo guardar una copia local de este recorrido.'); }
        if (offline) { setMessage('Mostrando condiciones guardadas; no se actualizó el historial.'); return; }
        const controller = newRequest();
        try { await post('/navigation/history', {ruta: r, origen: origin, destino: destination, modo: mode}, {signal: controller.signal}); }
        catch (e) { if (mounted.current && selection === selectionEpoch.current && !controller.signal.aborted) setMessage(`El recorrido se puede consultar, pero no se guardó en el historial: ${errorMessage(e)}`); }
        finally { requests.current.delete(controller); }
    };
    const loadCopy = (r: Ruta, from: Posicion | null | undefined, to: Posicion | null | undefined, savedMode: unknown, notice: string) => {
        if (!isRoute(r)) return setError('La copia del recorrido está incompleta. Busca un recorrido nuevo.');
        invalidate();
        originTouched.current = true;
        const first = r.geometria.coordinates[0], last = r.geometria.coordinates[r.geometria.coordinates.length - 1];
        setOrigin({...isPosition(from) ? from : {latitud: first[1], longitud: first[0]}, nombre: 'Origen guardado'});
        setDestination({...isPosition(to) ? to : {latitud: last[1], longitud: last[0]}, nombre: 'Destino guardado'});
        setManualOrigin([String(isPosition(from) ? from.latitud : first[1]), String(isPosition(from) ? from.longitud : first[0])]);
        setManualDestination([String(isPosition(to) ? to.latitud : last[1]), String(isPosition(to) ? to.longitud : last[0])]);
        setStep('routes'); setMode(routeMode(savedMode)); setLoadedCopy(true); setMessage(notice); onRoute({...r, copiaGuardada: true, llegadaEstimada: undefined, trafico: {disponible: false, fuente: null, actualizadoEn: r.trafico?.actualizadoEn ?? null, demoraSegundos: r.trafico?.demoraSegundos ?? 0, motivo: 'Condiciones guardadas; no hay tráfico actualizado.'}, modo: routeMode(savedMode), origen: isPosition(from) ? from : {latitud: first[1], longitud: first[0]}, destino: isPosition(to) ? to : {latitud: last[1], longitud: last[0]}});
    };
    const favorite = async () => {
        if (!active || offline || !isPosition(origin) || !isPosition(destination)) return;
        const controller = newRequest(); setBusy(true); setError('');
        try {
            await post('/navigation/favorites', {nombre: (favoriteName || `${origin.nombre} → ${destination.nombre}`).slice(0, 100), ruta: active, origen: origin, destino: destination, modo: mode, tags: usuario?.premium ? favoriteTags.split(',').map(t => t.trim()).filter(Boolean) : []}, {signal: controller.signal});
            if (!mounted.current) return;
            const data = await api<Saved[]>('/navigation/favorites', {signal: controller.signal});
            if (mounted.current) { setSaved(data.filter(item => isRoute(item.datos) && isPosition(item.origen) && isPosition(item.destino))); setMessage('Recorrido guardado en favoritos.'); }
        } catch (e) { if (mounted.current && !controller.signal.aborted) setError(errorMessage(e)); }
        finally { requests.current.delete(controller); if (mounted.current) setBusy(false); }
    };
    const locate = async () => {
        setLocating(true);
        try {
            const epoch = planEpoch.current;
            const point = await requestPosition();
            if (!mounted.current || epoch !== planEpoch.current) return;
            changeOrigin({ ...point, nombre: 'Mi ubicación actual' });
            onLocate?.(point);
            setError('');
        } catch (e) {
            if (mounted.current) setError(errorMessage(e));
        } finally { if (mounted.current) setLocating(false); }
    };
    useEffect(()=>{const choose=(event:Event)=>{const value=(event as CustomEvent<Punto>).detail;if(isPosition(value)&&typeof value.nombre==='string'){changeDestination(value);setMessage('Destino elegido. Selecciona tu transporte.');}};window.addEventListener('civigo:choose-place',choose);return()=>window.removeEventListener('civigo:choose-place',choose);},[changeDestination]);
    const closeAssistant = () => { planEpoch.current++; planRequest.current?.abort(); setBusy(false); setExplorer({open:false,query:''}); setStep('idle'); };
    const back = () => { setError(''); setMessage(''); if(step === 'routes') { invalidate(); setStep('transport'); } else if(step === 'origin' || step === 'transport') setStep('destination'); else closeAssistant(); };
    const stepHeader = <header className="route-step-header"><button type="button" className="icon-btn" aria-label="Volver al paso anterior" onClick={back}><ArrowLeft size={18}/></button><div><small>{step === 'destination' ? 'PASO 1 · DESTINO' : step === 'origin' ? 'UBICACIÓN DE SALIDA' : step === 'transport' ? 'PASO 2 · TRANSPORTE' : 'PASO 3 · RECORRIDO'}</small><h2>{step === 'destination' ? 'Elige tu destino' : step === 'origin' ? '¿Desde dónde sales?' : step === 'transport' ? '¿Cómo te moverás?' : 'Elige tu recorrido'}</h2></div><button type="button" className="icon-btn" aria-label="Cerrar planificación" onClick={closeAssistant}><X size={18}/></button></header>;
    if (!following && step === 'idle') return <CiviDroidLauncher onActivate={() => setStep(destination ? (active ? 'routes' : origin ? 'transport' : 'origin') : 'destination')}/>;
    if (following && active && guidance) return <NavigationGuidance route={active} onFinish={() => onFollow(false)} compact={compact} {...guidance}/>;
    if (!usuario) {
        return <div className={'card ' + styles.planner}>
            {stepHeader}
            <p className={'muted ' + styles.intro}>Crea una cuenta para comparar recorridos a pie, en bicicleta o en automóvil.</p>
            <Link href="/ingresar" className={'btn btn-primary ' + styles.fullWidth}>Ingresar para calcular rutas</Link>
        </div>;
    }
    return <div ref={wizardRef} className={'card route-assistant-wizard ' + styles.planner} data-assistant-step={step}>
        {stepHeader}
        {step === 'destination' && <>
        <CiviDroid onSearch={query=>setExplorer({open:true,query})}/>
        <button type="button" className={'btn btn-quiet btn-small ' + styles.manualToggle} aria-expanded={manual} onClick={() => setManual(!manual)}>
            {manual ? 'Ocultar' : 'Ingresar'} coordenadas manualmente
        </button>
        {manual && <div className={styles.manualFields}>
            {[{ label: 'Destino', values: manualDestination, origin: false }].map(({ label, values, origin: isOrigin }) =>
                <div key={label}>
                    <span className={styles.manualLabel}>{label}</span>
                    <div className={'grid-2 ' + styles.coordinateGrid}>
                        <div className="field"><input aria-label={'Latitud ' + label} type="number" step=".000001" placeholder="Latitud" value={values[0]} onChange={e => changeManual(isOrigin, 0, e.target.value)}/></div>
                        <div className="field"><input aria-label={'Longitud ' + label} type="number" step=".000001" placeholder="Longitud" value={values[1]} onChange={e => changeManual(isOrigin, 1, e.target.value)}/></div>
                    </div>
                </div>)}
            <button type="button" className="btn btn-primary btn-small" disabled={!destination} onClick={() => setStep(origin ? 'transport' : 'origin')}>Continuar</button>
        </div>}
        <div className={styles.shortcuts} aria-label="Destinos rápidos">
            {['Plaza de Armas de Ica', 'Huacachina', 'Hospital Regional de Ica', 'Terminal Terrestre Ica'].map(name => <button type="button" key={name} onClick={() => setExplorer({open:true,query:name})}><MapPin size={13} aria-hidden="true"/>{name}</button>)}
            {saved.slice(0, 8).map(item => <button type="button" key={`saved-${item.id}`} onClick={() => loadCopy(item.datos, item.origen, item.destino, item.modo, 'Favorito cargado. Actualiza sus condiciones antes de iniciar.')}><Bookmark size={13} aria-hidden="true"/>{item.nombre}</button>)}
        </div>
        </>}
        {step === 'origin' && <>
        <div className={styles.originDetails}>
            <p className="muted">{origin?.nombre || 'Usa el GPS o busca tu punto de salida.'}</p>
        <div className={styles.placeField}>
            <Search className={styles.searchIcon} size={16} aria-hidden="true"/>
            <PlaceInput label="Origen" value={origin} onChange={changeOrigin}/>
        </div>
        <div className={styles.pointActions}>
            <button type="button" className={'btn btn-quiet btn-small ' + styles.location} disabled={locating} onClick={locate}>
                <MapPin size={15} aria-hidden="true"/>{locating ? 'Buscando tu ubicación…' : 'Usar mi ubicación'}
            </button>

        </div>
        </div>
            <button type="button" className="btn btn-primary" disabled={!origin} onClick={() => setStep('transport')}>Continuar</button>
        </>}
        {step === 'transport' && <><p className="route-step-destination">{destination?.nombre}</p>
        <div className={'route-mode ' + styles.modes} role="group" aria-label="Modo de recorrido" >
            {[{ id: 'walking', name: 'A pie', icon: Footprints }, { id: 'cycling', name: 'Bicicleta', icon: Bike }, { id: 'driving', name: 'Auto', icon: Car }].map(({ id, name, icon: Icon }) =>
                <button type="button" aria-pressed={mode === id} className={mode === id ? 'selected' : ''} key={id} onClick={() => { setMode(id); if(destination && origin)void plan(id); }}>
                    <Icon size={20} aria-hidden="true"/><span>{name}</span>
                </button>)}
        </div>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setStep('origin')}>Cambiar punto de salida</button>
        </>}
        {step === 'routes' && <>
        {busy && <p role="status">Calculando alternativas…</p>}
        {message && <div className={'notice ' + styles.notice} role="status">{message}</div>}
        {routes.length > 0 && <section className={styles.alternatives} aria-label="Alternativas de recorrido">
            <div className={styles.resultHeading}><span>Elige tu recorrido</span><span>{routes.length} alternativa{routes.length > 1 ? 's' : ''}</span></div>
            {routes.map(r => {
                const RouteIcon = r.tipo === 'segura' ? ShieldCheck : r.tipo === 'equilibrada' ? Scale : Timer;
                const selected = active?.id === r.id;
                const knownRisk = r.riesgoConocido !== false;
                return <button type="button" key={r.id} aria-pressed={selected} className={['route-option', styles.option, selected ? 'selected ' + styles.selected : ''].join(' ')} onClick={() => select(r)}>
                    <span className={styles.optionHeading}>
                        <span className={styles.criterionIcon} data-criterion={r.tipo}><RouteIcon size={21} aria-hidden="true"/></span>
                        <strong>{r.nombre}</strong>
                        {selected ? <Check size={18} aria-label="Seleccionada"/> : <ChevronRight size={18} aria-hidden="true"/>}
                    </span>
                    <span className={styles.metrics}>
                        <span><b>{formatDuration(r.duracion)}</b></span>
                        <span className={styles.metricSeparator} aria-hidden="true">·</span>
                        <span><b>{(r.distancia / 1000).toFixed(1)}</b><span>km</span></span>
                    </span>
                    {r.criterios && r.criterios.length > 1 && <span className={styles.comparison}>Coincide con {r.criterios.map(c => c === 'rapida' ? 'más rápida' : c === 'segura' ? 'más segura' : 'equilibrada').join(' y ')}</span>}
                    <span className={styles.riskRow}>
                        <ShieldCheck size={14} aria-hidden="true"/>
                        <span>{knownRisk ? RISK_NAMES[r.nivelRiesgo] : 'Riesgo sin información'}</span>
                        {knownRisk && <span className={styles.riskLevel}>Nivel {r.nivelRiesgo}</span>}
                    </span>
                    {knownRisk && <span className={styles.riskDetail}>
                        <span className={styles.riskSegments} aria-hidden="true">{RISK_COLORS.map((color, level) =>
                            <span key={color} style={{ background: color, opacity: level === r.nivelRiesgo ? 1 : 0.25 }}/>)}</span>
                        <span>{Number(r.puntosRiesgo).toFixed(2)} puntos de exposición</span>
                    </span>}
                    <span className={styles.traffic}>
                        <Timer size={13} aria-hidden="true"/>
                        <span>{routeTimeSource(r)}{r.trafico?.disponible && r.trafico.demoraSegundos > 0 ? ` · +${Math.max(1, Math.round(r.trafico.demoraSegundos / 60))} min de demora` : ''}</span>
                    </span>
                    {r.advertencias?.length > 0 && <span className={styles.warning}>
                        <AlertTriangle size={13} aria-hidden="true"/>{r.advertencias.length} aviso{r.advertencias.length > 1 ? 's' : ''} sobre el recorrido
                    </span>}
                </button>;
            })}
            <p className={'muted ' + styles.comparisonNote}>La seguridad compara el riesgo registrado entre las alternativas disponibles. La falta de reportes no garantiza seguridad.</p>
        </section>}
        {active && <div className={styles.activeActions}>
            {loadedCopy && <div className={'notice notice-warning ' + styles.notice}>Copia guardada. La geometría, las condiciones y los avisos pertenecen al momento de su carga; recalcula con conexión para actualizarlos.</div>}
            <details className="route-save-options"><summary>Guardar en favoritos</summary><div className="field"><label htmlFor="favorite-name">Nombre para guardar</label><input id="favorite-name" value={favoriteName} onChange={e => setFavoriteName(e.target.value)} maxLength={100} placeholder="Casa → universidad"/></div>
            {usuario.premium && <div className="field"><label htmlFor="favorite-tags">Etiquetas Premium</label><input id="favorite-tags" value={favoriteTags} onChange={e => setFavoriteTags(e.target.value)} placeholder="Trabajo, mañana"/><small>Separa las etiquetas con comas.</small></div>}
            <button type="button" className="btn btn-secondary btn-small" disabled={busy || offline} onClick={favorite}><Bookmark size={14}/>Guardar favorito</button></details>
            <div className={'actions ' + styles.navigationActions}>
                <button type="button" className="btn btn-primary btn-small" onClick={() => onFollow(!following)}>{following ? <Square size={14} aria-hidden="true"/> : <Navigation size={14} aria-hidden="true"/>} {following ? 'Finalizar' : 'Iniciar recorrido'}</button>

            </div>
            {active.advertencias?.map((w, i) => <div className={'notice notice-warning ' + styles.notice} key={i}>{typeof w === 'string' ? w : w.mensaje}</div>)}
            <p className={'muted ' + styles.comparisonNote}>Al iniciar, se usa tu ubicación mientras la página esté abierta. Las recomendaciones comerciales no modifican el recorrido.</p>
        </div>}
        </>}
        {step === 'destination' && saved.length > 0 && <details className={styles.savedRoutes}>
            <summary>Favoritos ({saved.length})</summary>
            {saved.map(s => <button type="button" key={s.id} className="route-option" onClick={() => loadCopy(s.datos, s.origen, s.destino, s.modo, 'Favorito cargado. Busca recorridos para actualizar sus condiciones.')}>
                <strong>{s.nombre}</strong><p>Datos guardados; recalcula para actualizar.</p>
            </button>)}
        </details>}
        {step === 'destination' && cached.length > 0 && <details className={styles.savedRoutes}>
            <summary>Recorridos cargados en este dispositivo</summary>
            <p className={'muted ' + styles.comparisonNote}>La geometría guardada se puede consultar sin conexión. El mapa base puede necesitar internet. Los incidentes no se consideran actualizados.</p>
            {cached.map((c, i) => <button type="button" className="route-option" key={c.ruta.id + '-' + i} onClick={() => loadCopy(c.ruta, c.origen, c.destino, c.modo, 'Mostrando una copia guardada. No refleja necesariamente los incidentes actuales.')}>
                <strong>{c.ruta.nombre}</strong><p>Guardado: {formatDate(c.fecha)}</p>
            </button>)}
        </details>}
        {error && <div className={'notice notice-error ' + styles.notice} role="alert">{error}</div>}
        <DestinationExplorer open={explorer.open} initialQuery={explorer.query} onClose={()=>setExplorer(value=>({...value,open:false}))} ownerId={accountId??null} currentPosition={currentPosition} route={active} onChoose={changeDestination} onShowPlace={onShowPlace ? place => { closeAssistant(); onShowPlace(place); } : undefined}/>
    </div>;
}
