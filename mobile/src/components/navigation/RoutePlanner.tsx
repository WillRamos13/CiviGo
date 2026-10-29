import React, { useState, useEffect, useRef } from 'react';
import { Footprints, Bike, Car, MapPin, Navigation, Bookmark, RotateCw, AlertTriangle, Check, Volume2, VolumeX, ShieldCheck, Timer, Scale, ChevronRight, ArrowUp, CornerUpLeft, CornerUpRight, Undo2, Flag, LocateFixed, Square, Search, ChevronDown } from 'lucide-react';
import { NavigationService, AutoRerouteGuard, formatDistance, formatDuration, isPosition, isUsableFix, routeWarnings, onFavoritesChanged, type SavedRoute, type NavigationPlace } from '../../services/navigation';
import { RouteProgressTracker } from '../../services/navigationProgress';
import { NavigationSpeedFilter } from '../../services/navigationSpeed';
import { canContinueAfterStop, planAfterStop, planIntermediateStop, type RouteStopPreview } from '../../services/navigationStops';
import { useAuth } from '../../hooks/useAuth';
import { useAppActivity } from '../../hooks/useAppActivity';
import { errorMessage } from '../../services/api';
import { triggerHaptic } from '../../services/native';
import { RISK_COLORS, RISK_NAMES } from '../../types';
import type { Posicion, Ruta, LocationFix } from '../../types';
import { SpotifyNavPlayer } from './SpotifyNavPlayer';
import { DestinationExplorer } from './DestinationExplorer';
import CiviDroid from './CiviDroid';
import { compactNavigationStatus, headingLabel, maneuverDirection, routeArrivalLabel, routeCriterionLabel, routeEstimateSource, routeRiskSummary, splitNavigationWarnings } from '../../services/navigationPresentation';
import { navigationVoiceSupported, speakNavigation, stopNavigationVoice } from '../../services/navigationVoice';
import './navigation-glass.css';

type Mode = 'walking' | 'cycling' | 'driving';
interface RoutePlannerProps {
  currentPosition?: LocationFix | null;
  onSelectRoute: (ruta: Ruta | null) => void;
  activeRoute: Ruta | null;
  onStartNavigation?: (ruta: Ruta) => void;
  onStopNavigation?: () => void;
  isNavigating?: boolean;
  compact?: boolean;
  onRecenter?: () => void;
  restoredProgress?: number;
  onProgressChange?: (coveredDistance: number) => void;
  onShowPlace?: (place: NavigationPlace) => void;
  onChooseStop?: (place: NavigationPlace) => void;
}
const ICA_PLACES = [
  { nombre: 'Plaza de Armas de Ica', latitud: -14.0678, longitud: -75.7286 },
  { nombre: 'Huacachina Oasis', latitud: -14.0875, longitud: -75.7633 },
  { nombre: 'Terminal Terrestre Ica', latitud: -14.0631, longitud: -75.7335 },
  { nombre: 'Hospital Regional de Ica', latitud: -14.0722, longitud: -75.7410 },
];
const modeLabels = { walking: 'A pie', cycling: 'Bicicleta', driving: 'Auto' };

export const RoutePlanner: React.FC<RoutePlannerProps> = ({
  currentPosition, onSelectRoute, activeRoute, onStartNavigation, onStopNavigation,
  isNavigating = false, compact = false, onRecenter, restoredProgress = 0, onProgressChange, onShowPlace, onChooseStop,
}) => {
  const { usuario } = useAuth();
  const appActive = useAppActivity();
  const [destinationName, setDestinationName] = useState('');
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerQuery,setExplorerQuery]=useState<string>();
  const [latitudeInput, setLatitudeInput] = useState('');
  const [longitudeInput, setLongitudeInput] = useState('');
  const [destCoords, setDestCoords] = useState<Posicion | null>(null);
  const [mode, setMode] = useState<Mode>('walking');
  const [routes, setRoutes] = useState<Ruta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stopPreview, setStopPreview] = useState<RouteStopPreview | null>(null);
  const [stopBusy, setStopBusy] = useState(false);
  const [favorites, setFavorites] = useState<SavedRoute[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedRoute, setSavedRoute] = useState('');
  const savingRequest = useRef(false);
  const [voice, setVoice] = useState(true);
  const [voiceError, setVoiceError] = useState('');
  const [now, setNow] = useState(Date.now());
  const request = useRef<AbortController | null>(null);
  const favoritesRequest = useRef<AbortController | null>(null);
  const refreshFavorites = useRef<(() => void) | null>(null);
  const foreground = useRef(appActive);
  foreground.current = appActive;
  const mounted = useRef(false);
  const userId = useRef(usuario?.id);
  userId.current = usuario?.id;
  const latestSpeech = useRef('');
  const lastEstimateAttempt = useRef(Date.now());
  const rerouteGuard = useRef(new AutoRerouteGuard());
  const progressTracker = useRef(new RouteProgressTracker());
  const progressRoute = useRef<Ruta | null>(null);
  const speedFilter = useRef(new NavigationSpeedFilter());
  if (progressRoute.current !== activeRoute) {
    progressRoute.current = activeRoute;
    if (activeRoute) {
      progressTracker.current.seed(activeRoute, restoredProgress);
    }
    else progressTracker.current.reset();
    speedFilter.current.reset();
  }
  const readingNow = Math.max(now, Date.now());
  const computedProgress = activeRoute ? progressTracker.current.update(activeRoute, appActive ? currentPosition : null, readingNow) : null;
  const progress = computedProgress;
  const stopReached = !!activeRoute && canContinueAfterStop(activeRoute, appActive ? currentPosition : null, readingNow);
  const navigationArrived = activeRoute?.paradaIntermedia ? stopReached : progress?.arrived;
  const speed = speedFilter.current.update(appActive && isNavigating ? currentPosition : null, readingNow);
  const warnings = splitNavigationWarnings(activeRoute ? routeWarnings(activeRoute) : []);
  const turn = progress?.nextStep || progress?.step;
  const turnStage = !progress ? 'waiting' : progress.distanceToNext <= 30 ? 'turn' : progress.distanceToNext <= 100 ? 'near' : 'ahead';

  useEffect(() => {
    if (isNavigating && progress?.accepted) onProgressChange?.(progress.coveredDistance);
  }, [isNavigating, progress?.accepted, progress?.coveredDistance, onProgressChange]);

  useEffect(() => { setStopPreview(null); }, [activeRoute]);

  useEffect(() => {
    setNow(Date.now());
    if (!appActive) {
      request.current?.abort(); favoritesRequest.current?.abort(); setBusy(false); setStopBusy(false);
      speedFilter.current.reset();
      void stopNavigationVoice().catch(() => {});
    }
  }, [appActive]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);

  useEffect(() => {
    let controller: AbortController | null = null;
    request.current?.abort();
    setBusy(false);
    setSavedRoute('');
    setRoutes([]);
    setFavorites([]);
    setExplorerOpen(false); setExplorerQuery(undefined);
    setStopPreview(null); setStopBusy(false);
    setDestinationName(''); setDestCoords(null);
    setLatitudeInput(''); setLongitudeInput(''); setMode('walking');
    if (!usuario || usuario.bloqueado) return;
    const loadFavorites = () => {
      if (!foreground.current) return;
      controller?.abort();
      const current = new AbortController();
      controller = current;
      favoritesRequest.current = current;
      void NavigationService.getFavorites(current.signal)
        .then((values) => { if (!current.signal.aborted) setFavorites(values); })
        .catch((err) => { if (!current.signal.aborted) setError(`Favoritos: ${errorMessage(err)}`); });
    };
    refreshFavorites.current = loadFavorites;
    loadFavorites();
    const unsubscribe = onFavoritesChanged(loadFavorites);
    return () => { controller?.abort(); refreshFavorites.current = null; unsubscribe(); };
  }, [usuario?.id, usuario?.bloqueado]);

  const previousActivity = useRef(appActive);
  useEffect(() => {
    if (appActive && !previousActivity.current) refreshFavorites.current?.();
    previousActivity.current = appActive;
  }, [appActive]);

  useEffect(() => {
    if (!isNavigating || !appActive) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => { clearInterval(timer); request.current?.abort(); };
  }, [isNavigating, appActive]);

  // Starting a trip is the user's voice gesture. Both native and browser queues
  // are stopped on finish, stale GPS, off-route guidance and account changes.
  useEffect(() => {
    let current = true;
    if (!voice || !isNavigating || !appActive || !progress?.hasFix || progress.offRoute) {
      void stopNavigationVoice().catch(() => {});
      latestSpeech.current = '';
      return;
    }
    const instruction = navigationArrived ? activeRoute?.paradaIntermedia
      ? 'Llegaste a la parada. Tu destino final sigue guardado. Cuando termines, pulsa Continuar al destino final.'
      : 'Llegaste al final del recorrido. Comprueba el acceso al destino.' : turn?.instruccion || '';
    const key = `${activeRoute?.id}:${turn?.id}:${navigationArrived ? 'arrival' : turnStage}:${instruction}`;
    if (instruction && latestSpeech.current !== key && navigationVoiceSupported()) {
      latestSpeech.current = key;
      const text = navigationArrived ? instruction : `En ${formatDistance(progress.distanceToNext)}, ${instruction}`;
      void speakNavigation(text).catch((error: unknown) => {
        if (!current || (error && typeof error === 'object' && 'code' in error && error.code === 'SPEECH_CANCELLED')) return;
        setVoice(false);
        setVoiceError('La voz no está disponible. Sigue las indicaciones en pantalla.');
      });
    }
    return () => { current = false; void stopNavigationVoice().catch(() => {}); };
  }, [voice, isNavigating, appActive, activeRoute?.id, activeRoute?.paradaIntermedia?.nombre, progress?.step?.id, turn?.id, turn?.instruccion, turnStage, navigationArrived, progress?.hasFix, progress?.offRoute, usuario?.id]);

  const handlePlan = async (destination = destCoords, selectedMode = mode, navigating = false, name = destinationName) => {
    // A changed destination invalidates even a request whose replacement cannot start.
    request.current?.abort();
    request.current = null;
    setBusy(false);
    if (!appActive) return;
    if (!navigating) {
      setRoutes([]);
      setSavedRoute('');
      onSelectRoute(null);
    }
    if (!isUsableFix(currentPosition)) {
      setError('Se necesita una ubicación GPS reciente y precisa. Pulsa Ubicar mi posición.');
      return;
    }
    if (!isPosition(destination)) { setError('Elige un destino en Ica.'); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError(navigating ? 'Sin conexión. Se conserva el último recorrido; vuelve a recalcular cuando tengas red.' : 'Sin conexión. Conéctate para calcular una ruta actual.');
      return;
    }
    if (navigating) rerouteGuard.current.recordAttempt();
    const controller = new AbortController();
    request.current = controller;
    lastEstimateAttempt.current = Date.now();
    setBusy(true);
    setError('');
    try {
      const results = await NavigationService.planRoute(currentPosition, destination, selectedMode, controller.signal);
      if (!mounted.current || controller.signal.aborted || request.current !== controller) return;
      const prepared = results.map((route) => ({ ...route, origen: currentPosition, destino: destination, destinoNombre: name, modo: selectedMode,
        ...(navigating && activeRoute?.paradaIntermedia ? { paradaIntermedia: activeRoute.paradaIntermedia } : {}) }));
      if (!prepared.length) { setError(navigating ? 'No se encontraron rutas. Se conserva el último recorrido.' : 'No se encontraron rutas para este destino.'); return; }
      setRoutes(prepared);
      const selected = navigating ? prepared.find((route) => route.tipo === activeRoute?.tipo) || prepared[0] : prepared[0];
      onSelectRoute(selected);
    } catch (err) {
      if (!controller.signal.aborted && mounted.current && request.current === controller) setError(navigating ? `${errorMessage(err)} Se conserva el último recorrido.` : errorMessage(err));
    } finally {
      if (mounted.current && request.current === controller) setBusy(false);
    }
  };

  useEffect(() => {
    if (!isNavigating || !appActive || stopReached || !activeRoute?.destino) { rerouteGuard.current.reset(); return; }
    if (rerouteGuard.current.shouldReroute(currentPosition, !!computedProgress?.offRoute, Date.now(), !busy && !stopBusy && navigator.onLine)) {
      void handlePlan(activeRoute.destino, activeRoute.modo || mode, true, activeRoute.destinoNombre);
    }
  }, [currentPosition, isNavigating, appActive, stopReached, activeRoute, busy, stopBusy, computedProgress?.offRoute]);

  useEffect(() => {
    // Reuse the existing real planner, bounded to one foreground refresh per
    // three minutes. No artificial traffic factor or background polling.
    if (!isNavigating || !appActive || busy || stopBusy || stopPreview || !navigator.onLine || activeRoute?.modo !== 'driving' ||
        !activeRoute.destino || !progress?.hasFix || progress.offRoute || navigationArrived || now - lastEstimateAttempt.current < 180000) return;
    void handlePlan(activeRoute.destino, activeRoute.modo, true, activeRoute.destinoNombre);
  }, [now, isNavigating, appActive, busy, stopBusy, stopPreview, activeRoute, progress?.hasFix, progress?.offRoute, navigationArrived]);

  const selectDestination = (place: { nombre: string } & Posicion, selectedMode?: Mode) => {
    request.current?.abort(); setBusy(false); setError('');
    setExplorerOpen(false);
    setDestinationName(place.nombre);
    const destination = { latitud: place.latitud, longitud: place.longitud };
    setDestCoords(destination);
    setRoutes([]); onSelectRoute(null);
    if(selectedMode)void handlePlan(destination, selectedMode, false, place.nombre);
  };

  const saveFavorite = async (route: Ruta) => {
    if (savingRequest.current || !usuario || !route.origen || !route.destino) return;
    if (favorites.length >= (usuario.premium ? 20 : 3)) { setError(`Tu plan permite ${usuario.premium ? 20 : 3} rutas favoritas. Elimina una desde Perfil.`); return; }
    const owner = usuario.id;
    savingRequest.current = true;
    setSaving(true); setError('');
    try {
      const favorite = await NavigationService.addFavorite(route.destinoNombre || route.nombre || 'Ruta favorita', [], route, route.origen, route.destino, route.modo || mode);
      if (!mounted.current || userId.current !== owner) return;
      setFavorites((previous) => [favorite, ...previous.filter((item) => item.id !== favorite.id)]);
      setSavedRoute(route.id);
    } catch (err) {
      if (mounted.current && userId.current === owner) setError(`No se pudo guardar: ${errorMessage(err)}`);
    } finally { savingRequest.current = false; if (mounted.current) setSaving(false); }
  };

  const finish = () => {
    request.current?.abort();
    setBusy(false); setStopBusy(false); setStopPreview(null); setVoice(false); setError('');
    setVoiceError('');
    void stopNavigationVoice().catch(() => {});
    onStopNavigation?.();
  };

  const calculateStop = async (place: NavigationPlace) => {
    if (!isNavigating || !activeRoute || stopBusy || !appActive) return;
    if (!navigator.onLine) { setError('Sin conexión. No se puede calcular una parada; se conserva el recorrido actual.'); return; }
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setStopBusy(true); setBusy(false); setStopPreview(null); setError('');
    try {
      const preview = await planIntermediateStop(currentPosition, place, activeRoute, controller.signal);
      if (mounted.current && !controller.signal.aborted && request.current === controller) setStopPreview(preview);
    } catch (reason) {
      if (mounted.current && !controller.signal.aborted && request.current === controller) setError(`${errorMessage(reason)} Se conserva el recorrido actual.`);
    } finally { if (mounted.current && request.current === controller) setStopBusy(false); }
  };

  const continueAfterStop = async () => {
    if (!activeRoute?.paradaIntermedia || !stopReached || busy || stopBusy || !appActive) return;
    if (!navigator.onLine) { setError('Sin conexión. Tu destino final sigue guardado; conéctate para continuar.'); return; }
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try {
      const next = await planAfterStop(currentPosition, activeRoute, controller.signal);
      if (mounted.current && !controller.signal.aborted && request.current === controller) {
        setStopPreview(null); lastEstimateAttempt.current = Date.now(); onSelectRoute(next);
      }
    } catch (reason) {
      if (mounted.current && !controller.signal.aborted && request.current === controller) setError(`${errorMessage(reason)} Tu destino final sigue guardado.`);
    } finally { if (mounted.current && request.current === controller) setBusy(false); }
  };

  const destinationHandler=useRef<(place:NavigationPlace)=>void>(()=>{});
  destinationHandler.current=place=>{if(isNavigating)void calculateStop(place);else selectDestination(place);};
  useEffect(()=>{const choose=(event:Event)=>{const place=(event as CustomEvent<NavigationPlace>).detail;if(place&&isPosition(place)&&typeof place.nombre==='string')destinationHandler.current(place);};window.addEventListener('civigo:choose-place',choose);return()=>window.removeEventListener('civigo:choose-place',choose);},[]);
  const explorer = <DestinationExplorer key="destination-explorer" open={explorerOpen} initialQuery={explorerQuery} suspended={!appActive} onClose={() => setExplorerOpen(false)} ownerId={usuario?.id ?? null}
    currentPosition={currentPosition} activeRoute={activeRoute} navigationActive={isNavigating}
    onChooseDestination={selectDestination} onChooseStop={isNavigating ? onChooseStop || (place => void calculateStop(place)) : undefined}
    onShowPlace={onShowPlace ? place => { onShowPlace(place); setExplorerOpen(false); } : undefined} />;

  if (isNavigating && activeRoute && progress) {
    const arrivalLabel = progress.hasFix && !progress.offRoute ? routeArrivalLabel(activeRoute, progress.remainingDuration, now, true) : null;
    const estimate = routeEstimateSource(activeRoute, now);
    const nextInstruction = navigationArrived ? activeRoute.paradaIntermedia ? 'Parada alcanzada' : 'Destino alcanzado'
      : !progress.hasFix ? 'Esperando ubicación precisa' : progress.offRoute ? 'Fuera de ruta'
      : progress.arrived && activeRoute.paradaIntermedia ? 'Comprueba el acceso a la parada' : turn?.instruccion || 'Sigue la ruta del mapa';
    const direction = maneuverDirection(turn);
    const TurnIcon = navigationArrived || direction === 'arrival' ? Flag : direction === 'left' ? CornerUpLeft
      : direction === 'right' ? CornerUpRight : direction === 'uturn' ? Undo2 : direction === 'roundabout' ? RotateCw : ArrowUp;
    if (compact) {
      const status = compactNavigationStatus({ hasFix: progress.hasFix, offRoute: progress.offRoute, busy,
        urgent: warnings.urgent, error, voiceError });
      return <section className="civigo-navigation-glass navigation-guidance navigation-guidance-compact" aria-label="Indicaciones del recorrido">
        <div className="gn-compact-maneuver" data-direction={direction}>
          <TurnIcon size={18} aria-hidden="true" />
          <p>{!navigationArrived && progress.hasFix && !progress.offRoute && <strong>{formatDistance(progress.distanceToNext)} · </strong>}<span>{nextInstruction}</span></p>
        </div>
        <div className="gn-compact-row">
          <div className="gn-compact-summary" aria-live="polite">
            <strong>{navigationArrived ? 'Llegaste' : formatDuration(progress.remainingDuration)}{!navigationArrived && <span> restantes</span>}</strong>
            <small>{formatDistance(progress.remainingDistance)}{arrivalLabel ? ` · Llegada ${arrivalLabel}` : ' · Última estimación'}{activeRoute.paradaIntermedia ? ' · Hasta la parada' : ''}</small>
          </div>
          <div className="gn-compact-actions">
            <span className="gn-speed" aria-label={speed.available ? `Velocidad GPS ${speed.kmh} kilómetros por hora` : 'Velocidad GPS no disponible'}><strong>{speed.kmh ?? '—'}</strong><small>km/h</small></span>
            <button type="button" className="btn btn-danger btn-small" aria-label="Salir de navegación" onClick={finish}><Square size={12} aria-hidden="true" /><span>Salir</span></button>
          </div>
        </div>
        <p className={`gn-estimate-source ${estimate.stale ? 'gn-estimate-stale' : ''}`} title={estimate.description}>{estimate.label}</p>
        {activeRoute.paradaIntermedia && stopReached && <button type="button" className="btn btn-primary btn-small gn-stop-continue" disabled={busy || stopBusy} onClick={() => void continueAfterStop()}>Continuar al destino final</button>}
        {stopBusy && <p className="gn-compact-status" role="status">Calculando parada… Se conserva tu recorrido.</p>}
        {status && <p className={`gn-compact-status ${status.alert ? 'gn-compact-alert' : ''}`} role={status.alert ? 'alert' : 'status'} aria-label={status.description} title={status.description}><AlertTriangle size={12} aria-hidden="true" /><span>{status.text}</span></p>}
        <SpotifyNavPlayer key="spotify-nav" isNavigating compact />
        {explorer}
      </section>;
    }
    const compass = progress.hasFix ? headingLabel(currentPosition?.heading) : null;
    return <section className="civigo-navigation-glass navigation-guidance" aria-label="Indicaciones del recorrido">
      <div className="gn-turn-row">
        <span className="gn-maneuver" data-direction={direction}><TurnIcon size={30} aria-hidden="true" /></span>
        <div className="gn-turn-copy">
          <span className="gn-eyebrow">{navigationArrived ? activeRoute.paradaIntermedia ? 'PARADA ALCANZADA' : 'DESTINO ALCANZADO' : 'SIGUIENTE INDICACIÓN'}</span>
          <strong className="gn-turn-distance">{navigationArrived ? 'Llegaste' : progress.hasFix ? formatDistance(progress.distanceToNext) : 'Esperando GPS'}</strong>
          <p className="gn-turn-instruction">{nextInstruction}</p>
          {!navigationArrived && progress.step && <small>Ahora: {progress.step.instruccion}</small>}
          {!navigationArrived && <small className="gn-turn-context">hasta la siguiente indicación{turn?.calle ? ` · ${turn.calle}` : ''}{compass ? ` · Dirección ${compass}` : ''}</small>}
        </div>
      </div>
      <div className="navigation-summary gn-summary" aria-live="polite">
        <span><strong>{formatDuration(progress.remainingDuration)}</strong><small>tiempo estimado</small></span>
        <span><strong>{formatDistance(progress.remainingDistance)}</strong><small>restantes</small></span>
        <span><strong>{arrivalLabel || '—'}</strong><small>{arrivalLabel ? 'Llegada aprox.' : 'Esperando GPS'}</small></span>
      </div>
      <div className="gn-extended-estimate"><p className={`gn-estimate-source ${estimate.stale ? 'gn-estimate-stale' : ''}`} title={estimate.description}>{estimate.label}{estimate.updatedAt ? ` · ${estimate.updatedAt}` : ''}</p><span className="gn-speed" aria-label={speed.available ? `Velocidad GPS ${speed.kmh} kilómetros por hora` : 'Velocidad GPS no disponible'}><strong>{speed.kmh ?? '—'}</strong><small>km/h GPS</small></span></div>
      {activeRoute.paradaIntermedia && <p className="gn-stop-active">Hasta la parada: {activeRoute.paradaIntermedia.nombre}. Destino final conservado: {activeRoute.paradaIntermedia.destinoFinalNombre || 'ubicación guardada'}.</p>}
      {activeRoute.paradaIntermedia && stopReached && <button type="button" className="btn btn-primary gn-stop-continue" disabled={busy || stopBusy} onClick={() => void continueAfterStop()}>Continuar al destino final</button>}
      {!progress.hasFix ? <p className="navigation-alert gn-live-notice" role="status"><LocateFixed size={15} aria-hidden="true" />GPS sin señal reciente o con poca precisión. Se conserva la ruta.</p>
        : progress.offRoute ? <p className="navigation-alert gn-live-notice" role="status"><RotateCw size={15} aria-hidden="true" />{busy ? 'Recalculando desde tu ubicación…' : 'Te desviaste de la ruta. Se intentará recalcular desde tu GPS.'}</p>
        : busy && <p className="navigation-alert gn-live-notice" role="status">Recalculando desde tu ubicación… Se conserva la ruta anterior.</p>}
      {warnings.urgent.map((warning) => <p className="navigation-alert gn-urgent" role="status" key={warning}><AlertTriangle size={15} aria-hidden="true" />{warning}</p>)}
      {error && <p className="notice notice-error gn-error" role="alert">{error}</p>}
      {voiceError && <p className="gn-voice-notice" role="status">{voiceError}</p>}
      <div className="navigation-actions gn-navigation-actions">
        <button type="button" className="btn btn-secondary btn-small" disabled={!onRecenter || !progress.hasFix} onClick={onRecenter}><LocateFixed size={17} aria-hidden="true" />Centrar</button>
        <button type="button" className="btn btn-secondary btn-small" aria-label={voice ? 'Silenciar voz' : 'Activar voz'} aria-pressed={voice} disabled={!navigationVoiceSupported()} onClick={() => { setVoiceError(''); setVoice(!voice); }}>{voice ? <Volume2 size={17} aria-hidden="true" /> : <VolumeX size={17} aria-hidden="true" />}<span>Voz</span></button>
        <button type="button" className="btn btn-secondary btn-small" disabled={busy || stopBusy || !progress.hasFix || !activeRoute.destino} onClick={() => void handlePlan(activeRoute.destino, activeRoute.modo || mode, true, activeRoute.destinoNombre)}><RotateCw size={17} aria-hidden="true" /><span>{busy ? 'Recalculando…' : 'Recalcular'}</span></button>
        <button type="button" className="btn btn-danger btn-small" onClick={finish}><Square size={14} aria-hidden="true" />Finalizar</button>
      </div>
      {warnings.conditions.length > 0 && <details className="gn-conditions"><summary>Condiciones del recorrido <span>{warnings.conditions.length}</span><ChevronDown size={14} aria-hidden="true" /></summary><div className="navigation-alerts">{warnings.conditions.map((warning) => <p className="navigation-alert" key={warning}>{warning}</p>)}</div></details>}
      {stopBusy && <p className="gn-live-notice" role="status">Calculando los tramos y el desvío por carretera… Se conserva tu recorrido.</p>}
      {stopPreview && <section className="gn-stop-preview" aria-label="Confirmar parada">
        <strong>Parada: {stopPreview.place.nombre}</strong>
        <dl><div><dt>Hasta la parada</dt><dd>{formatDistance(stopPreview.firstLeg.distancia)} · {formatDuration(stopPreview.firstLeg.duracion)}</dd></div>
          <div><dt>Recorrido con parada</dt><dd>{formatDistance(stopPreview.combinedDistance)} · {formatDuration(stopPreview.combinedDuration)}</dd></div>
          <div><dt>Diferencia con ruta directa</dt><dd>{stopPreview.additionalDistance < 0 ? '−' : '+'}{formatDistance(Math.abs(stopPreview.additionalDistance))} · {stopPreview.additionalDuration < 0 ? '−' : '+'}{formatDuration(Math.abs(stopPreview.additionalDuration))}</dd></div></dl>
        <p>Calculado a las {new Date(stopPreview.calculatedAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' })} con rutas reales. No incluye el tiempo que permanezcas detenido. Cada tramo se calcula por separado y se actualizará al continuar.</p>
        <div><button type="button" className="btn btn-primary btn-small" disabled={busy || stopBusy || !progress.hasFix} onClick={() => {
          if (Date.now() - stopPreview.calculatedAt > 300000) { void calculateStop(stopPreview.place); return; }
          onSelectRoute(stopPreview.firstLeg); setStopPreview(null);
        }}>{now - stopPreview.calculatedAt > 300000 ? 'Actualizar cálculo' : 'Agregar parada'}</button><button type="button" className="btn btn-secondary btn-small" onClick={() => setStopPreview(null)}>Cancelar</button></div>
      </section>}
      <SpotifyNavPlayer key="spotify-nav" isNavigating compact={false} />
      <button type="button" className="btn btn-secondary btn-small gn-search-route" onClick={() => setExplorerOpen(true)}><Search size={16} aria-hidden="true" />Buscar en la ruta</button>
      {explorer}
    </section>;
  }

  return <section className="civigo-navigation-glass route-planner-mobile" aria-label="Planificar recorrido">
    <CiviDroid key={usuario?.id??'guest'} destination={destinationName} onSearch={query=>{setExplorerQuery(query);setExplorerOpen(true);}}/>
    <div className="route-mode-switch gn-mode-switch" hidden={!destCoords} role="group" aria-label="Modo de recorrido">
      {([{ id: 'walking', icon: Footprints }, { id: 'cycling', icon: Bike }, { id: 'driving', icon: Car }] as const).map(({ id, icon: Icon }) => <button key={id} type="button" className={`btn btn-small ${mode === id ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={mode === id} onClick={() => { setMode(id); if (destCoords) void handlePlan(destCoords, id); }}><Icon size={16} aria-hidden="true" /><span>{modeLabels[id]}</span></button>)}
    </div>
    <div className="field gn-search-field">
      <label>Destino</label>
      <button type="button" className="gn-search-launch" aria-label="Buscar destino en Ica" onClick={() => setExplorerOpen(true)}><Search size={17} aria-hidden="true" /><span>{destinationName || 'Buscar nombre o dirección en Ica'}</span><ChevronRight size={16} aria-hidden="true" /></button>
    </div>
    <details className="route-coordinate-input gn-conditions"><summary>Usar coordenadas del destino <ChevronDown size={14} aria-hidden="true" /></summary><form onSubmit={(event) => {
      event.preventDefault();
      const latitude = latitudeInput.trim().replace(',', '.'), longitude = longitudeInput.trim().replace(',', '.');
      const destination = { latitud: Number(latitude), longitud: Number(longitude) };
      if (!latitude || !longitude || !isPosition(destination)) { setError('Indica una latitud entre -90 y 90 y una longitud entre -180 y 180.'); return; }
      selectDestination({ ...destination, nombre: `${latitude}, ${longitude}` });
    }}><div className="grid-2"><div className="field"><label htmlFor="route-latitude">Latitud</label><input id="route-latitude" inputMode="decimal" placeholder="-14.0678" value={latitudeInput} onChange={(event) => setLatitudeInput(event.target.value)} required /></div><div className="field"><label htmlFor="route-longitude">Longitud</label><input id="route-longitude" inputMode="decimal" placeholder="-75.7286" value={longitudeInput} onChange={(event) => setLongitudeInput(event.target.value)} required /></div></div><button type="submit" className="btn btn-secondary btn-small" disabled={busy}>Calcular por coordenadas</button></form></details>
    <div className="gn-shortcuts"><div className="route-destinations" aria-label="Accesos locales en Ica">{ICA_PLACES.map((place) => <button key={place.nombre} type="button" className="btn btn-secondary btn-small" onClick={() => selectDestination(place)}><MapPin size={12} aria-hidden="true" />{place.nombre}</button>)}</div></div>
    {favorites.length > 0 && <details className="gn-conditions"><summary>Destinos favoritos <span>{favorites.length}</span><ChevronDown size={14} aria-hidden="true" /></summary><div className="route-destinations" aria-label="Destinos favoritos">{favorites.filter((favorite) => isPosition(favorite.destino)).map((favorite) => <button key={favorite.id} type="button" className="btn btn-secondary btn-small" onClick={() => { const selectedMode = favorite.modo in modeLabels ? favorite.modo as Mode : mode; setMode(selectedMode); selectDestination({ ...favorite.destino, nombre: favorite.nombre || 'Destino favorito' }, selectedMode); }}><Bookmark size={13} aria-hidden="true" />{favorite.nombre || 'Destino favorito'}</button>)}</div></details>}
    {destinationName && <p className="gn-destination"><MapPin size={14} aria-hidden="true" /><span>{destinationName}</span><small>{modeLabels[mode]}</small></p>}
    {error && <div className="notice notice-error gn-error" role="alert">{error}{destCoords && <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => void handlePlan()}>Reintentar</button>}</div>}
    {busy && <p role="status" className="gn-calculating"><RotateCw size={15} aria-hidden="true" />Calculando alternativas…</p>}
    {routes.length > 0 && <section className="route-results" aria-label="Alternativas de recorrido"><div className="gn-result-heading"><strong>Elige tu recorrido</strong><small>{routes.length} alternativa{routes.length === 1 ? '' : 's'}</small></div>{routes.map((route) => {
      const selected = activeRoute?.id === route.id;
      const risk = routeRiskSummary(route);
      const RouteIcon = route.tipo === 'segura' ? ShieldCheck : route.tipo === 'equilibrada' ? Scale : Timer;
      const notices = splitNavigationWarnings(routeWarnings(route));
      return <article className={`card route-result gn-route-card ${selected ? 'selected' : ''}`} key={route.id} data-criterion={route.tipo}>
        <button type="button" className="route-select gn-route-select" onClick={() => { void triggerHaptic('light'); onSelectRoute(route); }} aria-pressed={selected}>
          <span className="gn-option-heading"><span className="gn-criterion-icon"><RouteIcon size={17} aria-hidden="true" /></span><strong>{routeCriterionLabel(route.tipo)}</strong>{selected ? <Check size={16} aria-label="Seleccionada" /> : <ChevronRight size={16} aria-hidden="true" />}</span>
          <span className="gn-route-metrics"><strong>{formatDuration(route.duracion)}</strong><span>·</span><b>{formatDistance(route.distancia)}</b></span>
          <small className="gn-planned-arrival">Llegada aprox. {routeArrivalLabel(route) || 'sin estimación'}</small>
          {route.criterios && route.criterios.length > 1 && <span className="gn-shared-criteria">Coincide con {route.criterios.map(routeCriterionLabel).join(' y ').toLowerCase()}</span>}
          <span className="gn-risk-heading"><ShieldCheck size={14} aria-hidden="true" /><span>{risk.known && risk.level !== null ? `Riesgo registrado · ${RISK_NAMES[risk.level]}` : 'Riesgo sin verificar'}</span>{risk.known && <small>Nivel {risk.level}</small>}</span>
          {risk.known && <span className="gn-risk-scale" aria-label={`Nivel registrado ${risk.level} de 5`}>{RISK_COLORS.map((color, level) => <i key={color} style={{ backgroundColor: color, opacity: level === risk.level ? 1 : 0.28 }} />)}</span>}
          <span className="gn-traffic" title={routeEstimateSource(route).description}><Timer size={12} aria-hidden="true" />{routeEstimateSource(route).label}{route.trafico?.disponible && route.trafico.demoraSegundos > 0 ? ` · +${formatDuration(route.trafico.demoraSegundos)}` : ''}{risk.exposure !== null ? ` · ${risk.exposure.toFixed(2)} pt exposición` : ''}</span>
        </button>
        {notices.urgent.map((warning) => <p key={warning} className="navigation-alert gn-urgent"><AlertTriangle size={14} aria-hidden="true" />{warning}</p>)}
        {selected && <div className="navigation-actions gn-route-actions">
          <button type="button" className="btn btn-primary btn-small" disabled={busy || !isUsableFix(currentPosition)} onClick={() => { setVoice(true); setVoiceError(''); onStartNavigation?.(route); }}><Navigation size={16} aria-hidden="true" />Iniciar recorrido</button>
          {usuario && <button type="button" className="btn btn-secondary btn-small" disabled={saving || busy} onClick={() => void saveFavorite(route)} aria-label="Guardar ruta en favoritos">{savedRoute === route.id ? <Check size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}{saving ? 'Guardando…' : savedRoute === route.id ? 'Guardada' : 'Guardar'}</button>}
        </div>}
        {selected && notices.conditions.length > 0 && <details className="gn-conditions"><summary>Condiciones del recorrido <span>{notices.conditions.length}</span><ChevronDown size={14} aria-hidden="true" /></summary>{notices.conditions.map((warning) => <p key={warning} className="navigation-alert">{warning}</p>)}</details>}
      </article>;
    })}<p className="gn-comparison-note">La seguridad compara el riesgo registrado entre estas alternativas. La falta de reportes no garantiza seguridad.</p></section>}
    {!isUsableFix(currentPosition) && <p className="navigation-alert gn-live-notice"><LocateFixed size={15} aria-hidden="true" />Activa una ubicación GPS reciente para calcular o iniciar un recorrido.</p>}
    {explorer}
  </section>;
};
