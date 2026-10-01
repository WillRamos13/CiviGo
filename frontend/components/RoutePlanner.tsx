'use client';
import Link from 'next/link';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Footprints, Bike, Car, MapPin, Bookmark, Navigation, Square } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { api, post, currentPosition, errorMessage, formatDate } from '@/lib/api';
import type { Posicion, Ruta } from '@/lib/types';
import { RISK_COLORS, RISK_NAMES } from '@/lib/types';
import { readRouteCache, isPosition, isRoute, routeMode, type CachedRoute } from '@/lib/route-cache';
import PlaceInput from './PlaceInput';
type Punto = Posicion & { nombre: string };
type Saved = { id: number; nombre: string; modo: string; origen: Posicion; destino: Posicion; datos: Ruta; creadoEn: string };
type Props = { onRoute: (r: Ruta | null) => void; active: Ruta | null; following: boolean; onFollow: (v: boolean) => void; recalculate?: number };
export default function RoutePlanner(props: Props) {
    const { usuario } = useAuth();
    return <AccountRoutePlanner key={usuario?.id ?? 'publico'} {...props} />;
}
function AccountRoutePlanner({ onRoute, active, following, onFollow, recalculate = 0 }: Props) {
    const { usuario, offline } = useAuth();
    const accountId = usuario?.id, premium = usuario?.premium === true;
    const [origin, setOrigin] = useState<Punto | null>(null), [destination, setDestination] = useState<Punto | null>(null), [mode, setMode] = useState('walking'), [routes, setRoutes] = useState<Ruta[]>([]), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [manual, setManual] = useState(false), [cached, setCached] = useState<CachedRoute[]>([]), [saved, setSaved] = useState<Saved[]>([]), [safeDetour, setSafeDetour] = useState(.5), [balancedDetour, setBalancedDetour] = useState(.25), [favoriteName, setFavoriteName] = useState(''), [favoriteTags, setFavoriteTags] = useState(''), [loadedCopy, setLoadedCopy] = useState(false);
    const [manualOrigin, setManualOrigin] = useState(['', '']), [manualDestination, setManualDestination] = useState(['', '']);
    const mounted = useRef(true), planEpoch = useRef(0), selectionEpoch = useRef(0), planRequest = useRef<AbortController | null>(null), requests = useRef(new Set<AbortController>());
    const cleanupRequests = useCallback(() => { mounted.current = false; planEpoch.current++; selectionEpoch.current++; requests.current.forEach(c => c.abort()); requests.current.clear(); }, []);
    useEffect(() => { mounted.current = true; return cleanupRequests; }, [cleanupRequests]);
    const newRequest = () => { const controller = new AbortController(); requests.current.add(controller); return controller; };
    const invalidate = () => { planEpoch.current++; selectionEpoch.current++; planRequest.current?.abort(); setRoutes([]); setBusy(false); setMessage(''); setError(''); setLoadedCopy(false); onRoute(null); onFollow(false); };
    const changeOrigin = (value: Punto | null) => { invalidate(); setOrigin(value); setManualOrigin(value ? [String(value.latitud), String(value.longitud)] : ['', '']); };
    const changeDestination = (value: Punto | null) => { invalidate(); setDestination(value); setManualDestination(value ? [String(value.latitud), String(value.longitud)] : ['', '']); };
    const changeManual = (isOrigin: boolean, axis: number, text: string) => {
        const values = [...isOrigin ? manualOrigin : manualDestination]; values[axis] = text;
        (isOrigin ? setManualOrigin : setManualDestination)(values);
        const point = {latitud: Number(values[0]), longitud: Number(values[1]), nombre: isOrigin ? 'Origen' : 'Destino'};
        invalidate(); (isOrigin ? setOrigin : setDestination)(values.every(v => v.trim()) && isPosition(point) ? point : null);
    };
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
    const plan = async () => {
        if (!isPosition(origin) || !isPosition(destination)) return setError('Selecciona un origen y destino con coordenadas válidas.');
        if (offline) return setError('Para actualizar las condiciones del recorrido necesitas conexión. Puedes consultar tus copias guardadas.');
        planRequest.current?.abort();
        const controller = newRequest(), epoch = ++planEpoch.current;
        planRequest.current = controller;
        setBusy(true); setError(''); setMessage(''); setRoutes([]); setLoadedCopy(false); onFollow(false); onRoute(null);
        try {
            const data = await post<{rutas: Ruta[]}>('/navigation/plan', {origen: origin, destino: destination, modo: mode, maxDesvioSeguro: safeDetour, maxDesvioEquilibrado: balancedDetour}, {signal: controller.signal});
            if (!mounted.current || epoch !== planEpoch.current) return;
            if (!Array.isArray(data.rutas) || !data.rutas.every(isRoute)) throw new Error('El servicio devolvió recorridos incompletos. Inténtalo de nuevo.');
            setRoutes(data.rutas);
            if (!data.rutas.length) setMessage('No se encontraron alternativas disponibles para este recorrido.');
        } catch (e) { if (mounted.current && epoch === planEpoch.current && !controller.signal.aborted) setError(errorMessage(e)); }
        finally { requests.current.delete(controller); if (mounted.current && epoch === planEpoch.current) setBusy(false); }
    };
    useEffect(() => {
        if (recalculate > 0) void Promise.resolve().then(plan);
        // Recalculation is explicitly triggered by the route alert button.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recalculate]);
    const select = async (r: Ruta) => {
        if (!usuario || !isRoute(r)) return;
        const selection = ++selectionEpoch.current;
        onRoute(r); onFollow(false); setMessage(''); setLoadedCopy(offline);
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
        const first = r.geometria.coordinates[0], last = r.geometria.coordinates[r.geometria.coordinates.length - 1];
        setOrigin({...isPosition(from) ? from : {latitud: first[1], longitud: first[0]}, nombre: 'Origen guardado'});
        setDestination({...isPosition(to) ? to : {latitud: last[1], longitud: last[0]}, nombre: 'Destino guardado'});
        setManualOrigin([String(isPosition(from) ? from.latitud : first[1]), String(isPosition(from) ? from.longitud : first[0])]);
        setManualDestination([String(isPosition(to) ? to.latitud : last[1]), String(isPosition(to) ? to.longitud : last[0])]);
        setMode(routeMode(savedMode)); setLoadedCopy(true); setMessage(notice); onRoute(r);
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
    if (!usuario)
        return <div className="card"><div className="card-header"><h2>Tu próximo recorrido</h2><Navigation size={18} color="var(--brand)"/></div><p className="muted" style={{ fontSize: 12 }}>Crea una cuenta para comparar recorridos a pie, en bicicleta o en automóvil.</p><Link href="/ingresar" className="btn btn-primary" style={{ width: '100%' }}>Ingresar para calcular rutas</Link></div>;
    return <div className="card"><div className="card-header"><h2>¿A dónde vamos?</h2><Navigation size={18} color="var(--brand)"/></div><p className="muted" style={{ fontSize: 11 }}>Compara las alternativas disponibles en Ica.</p><div className="route-mode">{[{ id: 'walking', name: 'A pie', icon: Footprints }, { id: 'cycling', name: 'Bicicleta', icon: Bike }, { id: 'driving', name: 'Auto', icon: Car }].map(({ id, name, icon: Icon }) => <button type="button" aria-pressed={mode === id} className={mode === id ? 'selected' : ''} key={id} onClick={() => { invalidate(); setMode(id); }}><Icon size={16} style={{ margin: '0 auto 5px' }}/>{name}</button>)}</div><PlaceInput label="Origen" value={origin} onChange={changeOrigin}/><button className="btn btn-quiet btn-small" style={{ padding: '0 0 12px' }} onClick={async () => { try {
        const epoch = planEpoch.current; const point = await currentPosition(); if (!mounted.current || epoch !== planEpoch.current) return; changeOrigin({ ...point, nombre: 'Mi ubicación actual' });
        setError('');
    }
    catch (e) {
        setError(errorMessage(e));
    } }}><MapPin size={13}/>Usar mi ubicación</button><PlaceInput label="Destino" value={destination} onChange={changeDestination}/><button className="btn btn-quiet btn-small" style={{ padding: '0 0 12px', fontSize: 10 }} onClick={() => setManual(!manual)}>{manual ? 'Ocultar' : 'Ingresar'} coordenadas manualmente</button>{manual && <>{[{ label: 'Origen', values: manualOrigin, origin: true }, { label: 'Destino', values: manualDestination, origin: false }].map(({ label, values, origin: isOrigin }) => <div key={label}><small>{label}</small><div className="grid-2" style={{ gap: 7 }}><div className="field"><input aria-label={`Latitud ${label}`} type="number" step=".000001" placeholder="Latitud" value={values[0]} onChange={e => changeManual(isOrigin, 0, e.target.value)}/></div><div className="field"><input aria-label={`Longitud ${label}`} type="number" step=".000001" placeholder="Longitud" value={values[1]} onChange={e => changeManual(isOrigin, 1, e.target.value)}/></div></div></div>)}</>}<details style={{ marginBottom: 12 }}><summary style={{ fontSize: 11, cursor: "pointer" }}>Ajustar desvíos máximos</summary><div className="field" style={{ marginTop: 12 }}><label htmlFor="balanced-detour">Equilibrada: hasta {Math.round(balancedDetour * 100)} % más de tiempo</label><input id="balanced-detour" type="range" min="0" max="2" step=".05" value={balancedDetour} onChange={e => { invalidate(); setBalancedDetour(Number(e.target.value)); }}/></div><div className="field"><label htmlFor="safe-detour">Más segura: hasta {Math.round(safeDetour * 100)} % más de tiempo</label><input id="safe-detour" type="range" min="0" max="2" step=".05" value={safeDetour} onChange={e => { invalidate(); setSafeDetour(Number(e.target.value)); }}/><small>Comparado con el tiempo de la ruta más corta. El trazado disponible puede no ofrecer alternativas diferentes.</small></div></details><button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || offline || !origin || !destination} onClick={plan}>{busy ? 'Calculando alternativas…' : 'Buscar recorridos'}</button>{error && <div className="notice notice-error" style={{ marginTop: 12, fontSize: 11 }} role="alert">{error}</div>}{message && <div className="notice" style={{ marginTop: 12, fontSize: 11 }}>{message}</div>}{routes.length > 0 && <div style={{ marginTop: 15 }}><small className="muted">{routes.length} alternativa{routes.length > 1 ? 's' : ''} disponible{routes.length > 1 ? 's' : ''}</small>{routes.map(r => <button key={r.id} aria-pressed={active?.id === r.id} className={`route-option ${active?.id === r.id ? 'selected' : ''}`} onClick={() => select(r)}><strong>{r.nombre}</strong><p>{(r.distancia / 1000).toFixed(1)} km · {Math.max(1, Math.round(r.duracion / 60))} min</p><p><span className="legend-dot" style={{ display: 'inline-block', background: RISK_COLORS[r.nivelRiesgo], marginRight: 5 }}/>{RISK_NAMES[r.nivelRiesgo]} · {Number(r.puntosRiesgo).toFixed(2)} puntos de exposición</p>{r.advertencias?.length > 0 && <p style={{ color: '#b45309' }}>{r.advertencias.length} aviso{r.advertencias.length > 1 ? 's' : ''} sobre el recorrido</p>}</button>)}</div>}{active && <>{loadedCopy && <div className="notice notice-warning" style={{ marginTop: 12, fontSize: 11 }}>Copia guardada. La geometría, las condiciones y los avisos pertenecen al momento de su carga; recalcula con conexión para actualizarlos.</div>}<div className="field" style={{ marginTop: 15 }}><label htmlFor="favorite-name">Nombre para guardar</label><input id="favorite-name" value={favoriteName} onChange={e => setFavoriteName(e.target.value)} maxLength={100} placeholder="Casa → universidad"/></div>{usuario.premium && <div className="field"><label htmlFor="favorite-tags">Etiquetas Premium</label><input id="favorite-tags" value={favoriteTags} onChange={e => setFavoriteTags(e.target.value)} placeholder="Trabajo, mañana"/><small>Separa las etiquetas con comas.</small></div>}<div className="actions" style={{ marginTop: 12 }}><button className="btn btn-primary btn-small" onClick={() => onFollow(!following)}>{following ? <Square size={12}/> : <Navigation size={12}/>} {following ? 'Finalizar' : 'Iniciar recorrido'}</button><button className="btn btn-secondary btn-small" disabled={busy || offline} onClick={favorite}><Bookmark size={12}/>Guardar</button></div>{active.advertencias?.map((w, i) => <div className="notice notice-warning" key={i} style={{ fontSize: 11, marginTop: 10 }}>{typeof w === 'string' ? w : w.mensaje}</div>)}<p className="muted" style={{ fontSize: 10, marginTop: 10 }}>Al iniciar, se usa tu ubicación mientras la página esté abierta. Las recomendaciones comerciales no modifican el recorrido.</p></>}{saved.length > 0 && <details style={{ marginTop: 18 }}><summary style={{ fontSize: 12, cursor: 'pointer' }}>Favoritos ({saved.length})</summary>{saved.map(s => <button key={s.id} className="route-option" onClick={() => { loadCopy(s.datos, s.origen, s.destino, s.modo, 'Favorito cargado. Busca recorridos para actualizar sus condiciones.'); }}><strong>{s.nombre}</strong><p>Datos guardados; recalcula para actualizar.</p></button>)}</details>}{cached.length > 0 && <details style={{ marginTop: 15 }}><summary style={{ fontSize: 12, cursor: 'pointer' }}>Recorridos cargados en este dispositivo</summary><p className="muted" style={{ fontSize: 10, marginTop: 8 }}>La geometría guardada se puede consultar sin conexión. El mapa base puede necesitar internet. Los incidentes no se consideran actualizados.</p>{cached.map((c, i) => <button className="route-option" key={`${c.ruta.id}-${i}`} onClick={() => {loadCopy(c.ruta, c.origen, c.destino, c.modo, 'Mostrando una copia guardada. No refleja necesariamente los incidentes actuales.'); }}><strong>{c.ruta.nombre}</strong><p>Guardado: {formatDate(c.fecha)}</p></button>)}</details>}</div>;
}
