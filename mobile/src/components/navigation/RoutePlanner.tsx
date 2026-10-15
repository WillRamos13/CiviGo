import React, { useState, useEffect, useRef } from 'react';
import { Footprints, Bike, Car, MapPin, Navigation, Bookmark, RotateCw, AlertTriangle, Check, Volume2, VolumeX } from 'lucide-react';
import { NavigationService, AutoRerouteGuard, formatDistance, formatDuration, getRouteProgress, isPosition, isUsableFix, routeWarnings, onFavoritesChanged, type SavedRoute, type NavigationPlace } from '../../services/navigation';
import { useAuth } from '../../hooks/useAuth';
import { errorMessage } from '../../services/api';
import { triggerHaptic } from '../../services/native';
import { RISK_COLORS, RISK_NAMES } from '../../types';
import type { Posicion, Ruta, LocationFix } from '../../types';
import { SpotifyNavPlayer } from './SpotifyNavPlayer';

type Mode = 'walking' | 'cycling' | 'driving';
interface RoutePlannerProps {
  currentPosition?: LocationFix | null;
  onSelectRoute: (ruta: Ruta | null) => void;
  activeRoute: Ruta | null;
  onStartNavigation?: (ruta: Ruta) => void;
  onStopNavigation?: () => void;
  isNavigating?: boolean;
  compact?: boolean;
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
  isNavigating = false, compact = false,
}) => {
  const { usuario } = useAuth();
  const [destinationName, setDestinationName] = useState('');
  const [placeQuery, setPlaceQuery] = useState('');
  const [places, setPlaces] = useState<NavigationPlace[]>([]);
  const [placesBusy, setPlacesBusy] = useState(false);
  const [placesError, setPlacesError] = useState('');
  const [searchedQuery, setSearchedQuery] = useState('');
  const [activePlace, setActivePlace] = useState(0);
  const [latitudeInput, setLatitudeInput] = useState('');
  const [longitudeInput, setLongitudeInput] = useState('');
  const [destCoords, setDestCoords] = useState<Posicion | null>(null);
  const [mode, setMode] = useState<Mode>('walking');
  const [routes, setRoutes] = useState<Ruta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [favorites, setFavorites] = useState<SavedRoute[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedRoute, setSavedRoute] = useState('');
  const savingRequest = useRef(false);
  const [voice, setVoice] = useState(false);
  const [now, setNow] = useState(Date.now());
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const userId = useRef(usuario?.id);
  userId.current = usuario?.id;
  const latestSpeech = useRef('');
  const rerouteGuard = useRef(new AutoRerouteGuard());
  const computedProgress = activeRoute ? getRouteProgress(activeRoute, currentPosition, now) : null;
  const lastProgress = useRef<{ route: Ruta; progress: NonNullable<typeof computedProgress> } | null>(null);
  if (activeRoute && computedProgress?.hasFix && !computedProgress.offRoute) lastProgress.current = { route: activeRoute, progress: computedProgress };
  const progress = computedProgress && activeRoute === lastProgress.current?.route && (!computedProgress.hasFix || computedProgress.offRoute)
    ? { ...lastProgress.current.progress, hasFix: computedProgress.hasFix, offRoute: computedProgress.offRoute, arrived: false }
    : computedProgress;
  const warnings = activeRoute ? routeWarnings(activeRoute) : [];

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
    if (!usuario || usuario.bloqueado) return;
    const loadFavorites = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      void NavigationService.getFavorites(current.signal)
        .then((values) => { if (!current.signal.aborted) setFavorites(values); })
        .catch((err) => { if (!current.signal.aborted) setError(`Favoritos: ${errorMessage(err)}`); });
    };
    loadFavorites();
    const unsubscribe = onFavoritesChanged(loadFavorites);
    return () => { controller?.abort(); unsubscribe(); };
  }, [usuario?.id, usuario?.bloqueado]);

  useEffect(() => {
    const controller = new AbortController();
    setPlaces([]); setPlacesError(''); setPlacesBusy(false); setActivePlace(0); setSearchedQuery('');
    if (placeQuery.trim().length < 3 || isNavigating) return () => controller.abort();
    const timer = setTimeout(() => {
      setPlacesBusy(true);
      void NavigationService.searchPlaces(placeQuery, controller.signal)
        .then((items) => { if (!controller.signal.aborted) { setPlaces(items); setSearchedQuery(placeQuery.trim()); } })
        .catch((err) => { if (!controller.signal.aborted) setPlacesError(errorMessage(err)); })
        .finally(() => { if (!controller.signal.aborted) setPlacesBusy(false); });
    }, 350);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [placeQuery, isNavigating]);

  useEffect(() => {
    if (!isNavigating) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => { clearInterval(timer); request.current?.abort(); };
  }, [isNavigating]);

  // Voice starts only after the user enables it; queued speech stops with navigation.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const speech = window.speechSynthesis;
    if (!voice || !isNavigating || !progress?.hasFix || progress.offRoute) {
      speech.cancel();
      latestSpeech.current = '';
      return;
    }
    const text = progress.step?.instruccion || '';
    if (text && latestSpeech.current !== `${activeRoute?.id}:${text}`) {
      speech.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-PE';
      speech.speak(utterance);
      latestSpeech.current = `${activeRoute?.id}:${text}`;
    }
    return () => speech.cancel();
  }, [voice, isNavigating, activeRoute?.id, progress?.step?.id, progress?.hasFix, progress?.offRoute]);

  const handlePlan = async (destination = destCoords, selectedMode = mode, navigating = false) => {
    if (!isUsableFix(currentPosition)) {
      setError('Se necesita una ubicación GPS reciente y precisa. Pulsa Ubicar mi posición.');
      return;
    }
    if (!isPosition(destination)) { setError('Elige un destino en Ica.'); return; }
    request.current?.abort();
    if (navigating) rerouteGuard.current.recordAttempt();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const results = await NavigationService.planRoute(currentPosition, destination, selectedMode, controller.signal);
      if (!mounted.current || controller.signal.aborted || request.current !== controller) return;
      const prepared = results.map((route) => ({ ...route, origen: currentPosition, destino: destination, modo: selectedMode }));
      if (!prepared.length) { setError('No se encontraron rutas. Se conserva el último recorrido.'); return; }
      setRoutes(prepared);
      const selected = navigating ? prepared.find((route) => route.tipo === activeRoute?.tipo) || prepared[0] : prepared[0];
      onSelectRoute(selected);
    } catch (err) {
      if (!controller.signal.aborted && mounted.current && request.current === controller) setError(errorMessage(err));
    } finally {
      if (mounted.current && request.current === controller) setBusy(false);
    }
  };

  useEffect(() => {
    if (!isNavigating || !activeRoute?.destino) { rerouteGuard.current.reset(); return; }
    if (rerouteGuard.current.shouldReroute(currentPosition, !!computedProgress?.offRoute, Date.now(), !busy && navigator.onLine)) {
      void handlePlan(activeRoute.destino, activeRoute.modo || mode, true);
    }
  }, [currentPosition, isNavigating, activeRoute, busy, computedProgress?.offRoute]);

  const selectDestination = (place: { nombre: string } & Posicion, selectedMode = mode) => {
    setPlaceQuery(''); setPlaces([]);
    setDestinationName(place.nombre);
    const destination = { latitud: place.latitud, longitud: place.longitud };
    setDestCoords(destination);
    void handlePlan(destination, selectedMode);
  };

  const saveFavorite = async (route: Ruta) => {
    if (savingRequest.current || !usuario || !route.origen || !route.destino) return;
    if (favorites.length >= (usuario.premium ? 20 : 3)) { setError(`Tu plan permite ${usuario.premium ? 20 : 3} rutas favoritas. Elimina una desde Perfil.`); return; }
    const owner = usuario.id;
    savingRequest.current = true;
    setSaving(true); setError('');
    try {
      const favorite = await NavigationService.addFavorite(destinationName || route.nombre || 'Ruta favorita', [], route, route.origen, route.destino, route.modo || mode);
      if (!mounted.current || userId.current !== owner) return;
      setFavorites((previous) => [favorite, ...previous.filter((item) => item.id !== favorite.id)]);
      setSavedRoute(route.id);
    } catch (err) {
      if (mounted.current && userId.current === owner) setError(`No se pudo guardar: ${errorMessage(err)}`);
    } finally { savingRequest.current = false; if (mounted.current) setSaving(false); }
  };

  const finish = () => {
    request.current?.abort();
    setBusy(false); setVoice(false); setError('');
    onStopNavigation?.();
  };

  if (isNavigating && activeRoute && progress) {
    const nextInstruction = progress.arrived ? 'Llegaste al final del recorrido. Comprueba el acceso al destino.'
      : progress.nextStep?.instruccion || progress.step?.instruccion || 'Sigue la ruta del mapa. No hay indicaciones detalladas disponibles.';
    return <section className={`navigation-guidance ${compact ? 'navigation-guidance-compact' : ''}`} aria-label="Indicaciones del recorrido">
      <div className="navigation-guidance-heading">
        <div><span className="eyebrow">{progress.arrived ? 'FIN DEL RECORRIDO' : 'SIGUIENTE INDICACIÓN'}</span><strong>{nextInstruction}</strong>
          {!compact && !progress.arrived && progress.step && <small>Ahora: {progress.step.instruccion}</small>}
          {!progress.arrived && <small>{formatDistance(progress.distanceToNext)} hasta la siguiente indicación</small>}</div>
        <button type="button" className="btn btn-danger btn-small" onClick={finish}>Finalizar</button>
      </div>
      <div className="navigation-summary" aria-live="polite">
        <span><strong>{formatDistance(progress.remainingDistance)}</strong> restantes</span>
        <span><strong>{formatDuration(progress.remainingDuration)}</strong></span>
        <span>Llegada aprox. <strong>{new Date(now + progress.remainingDuration * 1000).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</strong></span>
      </div>
      {!progress.hasFix && <p className="navigation-alert" role="status">GPS sin señal reciente o con poca precisión. Se conserva la ruta; las indicaciones no se actualizan.</p>}
      {progress.offRoute && <p className="navigation-alert" role="status">Estás fuera de la ruta. Recalcula cuando sea seguro continuar.</p>}
      {busy && <p className="navigation-alert" role="status">Recalculando desde tu ubicación… Se conserva la ruta anterior.</p>}
      <div className="navigation-alerts" aria-label="Alertas del recorrido">{warnings.length ? warnings.map((warning) => <p className="navigation-alert" key={warning}><AlertTriangle size={13} /> {warning}</p>) : <p className="muted">Sin alertas informadas para esta ruta.</p>}</div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="navigation-actions">
        <button type="button" className="btn btn-secondary btn-small" disabled={busy || !progress.hasFix || !activeRoute.destino} onClick={() => void handlePlan(activeRoute.destino, activeRoute.modo || mode, true)}><RotateCw size={14} />{busy ? 'Recalculando…' : 'Recalcular'}</button>
        <button type="button" className="btn btn-secondary btn-small" aria-pressed={voice} disabled={typeof window === 'undefined' || !('speechSynthesis' in window)} onClick={() => setVoice(!voice)}>{voice ? <Volume2 size={14} /> : <VolumeX size={14} />}Voz {voice ? 'activada' : 'desactivada'}</button>
      </div>
      <SpotifyNavPlayer isNavigating />
    </section>;
  }

  return <div className="route-planner-mobile">
    <div className="route-mode-switch" aria-label="Modo de recorrido">
      {([{ id: 'walking', icon: Footprints }, { id: 'cycling', icon: Bike }, { id: 'driving', icon: Car }] as const).map(({ id, icon: Icon }) => <button key={id} type="button" className={`btn btn-small ${mode === id ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={mode === id} onClick={() => { setMode(id); if (destCoords) void handlePlan(destCoords, id); }}><Icon size={16} />{modeLabels[id]}</button>)}
    </div>
    <div className="field">
      <label htmlFor="route-destination-search">Buscar destino en Ica</label>
      <input id="route-destination-search" type="search" role="combobox" aria-autocomplete="list" aria-expanded={places.length > 0} aria-controls="route-place-results" aria-activedescendant={places.length ? `route-place-${activePlace}` : undefined} placeholder="Nombre o dirección (mínimo 3 caracteres)" maxLength={160} value={placeQuery} onChange={(event) => setPlaceQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape') { setPlaceQuery(''); return; }
        if (!places.length) return;
        if (event.key === 'ArrowDown') { event.preventDefault(); setActivePlace((index) => (index + 1) % places.length); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setActivePlace((index) => (index + places.length - 1) % places.length); }
        if (event.key === 'Enter') { event.preventDefault(); selectDestination(places[activePlace]); }
      }} />
      {placesBusy && <small role="status">Buscando lugares…</small>}
      {placesError && <small role="alert">{placesError} Puedes usar un acceso local o coordenadas.</small>}
      {searchedQuery === placeQuery.trim() && searchedQuery.length >= 3 && !placesBusy && !placesError && places.length === 0 && <small>Sin resultados disponibles para esta búsqueda.</small>}
      {places.length > 0 && <ul id="route-place-results" className="route-place-results" role="listbox" aria-label="Lugares encontrados">{places.map((place, index) => <li key={`${place.nombre}:${place.latitud}:${place.longitud}`} id={`route-place-${index}`} role="option" aria-selected={activePlace === index}><button type="button" onClick={() => selectDestination(place)}><strong>{place.nombre}</strong>{place.descripcion && <span>{place.descripcion}</span>}{place.fuente && <small>{place.fuente}</small>}</button></li>)}</ul>}
    </div>
    <details className="route-coordinate-input"><summary>Usar coordenadas del destino</summary><form onSubmit={(event) => {
      event.preventDefault();
      const latitude = latitudeInput.trim().replace(',', '.'), longitude = longitudeInput.trim().replace(',', '.');
      const destination = { latitud: Number(latitude), longitud: Number(longitude) };
      if (!latitude || !longitude || !isPosition(destination)) { setError('Indica una latitud entre -90 y 90 y una longitud entre -180 y 180.'); return; }
      selectDestination({ ...destination, nombre: `${latitude}, ${longitude}` });
    }}><div className="grid-2"><div className="field"><label htmlFor="route-latitude">Latitud</label><input id="route-latitude" inputMode="decimal" placeholder="-14.0678" value={latitudeInput} onChange={(event) => setLatitudeInput(event.target.value)} required /></div><div className="field"><label htmlFor="route-longitude">Longitud</label><input id="route-longitude" inputMode="decimal" placeholder="-75.7286" value={longitudeInput} onChange={(event) => setLongitudeInput(event.target.value)} required /></div></div><button type="submit" className="btn btn-secondary btn-small" disabled={busy}>Calcular por coordenadas</button></form></details>
    <p className="muted">Accesos locales en Ica:</p>
    <div className="route-destinations">{ICA_PLACES.map((place) => <button key={place.nombre} type="button" className="btn btn-secondary btn-small" onClick={() => selectDestination(place)}><MapPin size={12} />{place.nombre}</button>)}</div>
    {favorites.length > 0 && <div className="route-destinations" aria-label="Destinos favoritos">{favorites.filter((favorite) => isPosition(favorite.destino)).map((favorite) => <button key={favorite.id} type="button" className="btn btn-secondary btn-small" onClick={() => { const selectedMode = favorite.modo in modeLabels ? favorite.modo as Mode : mode; setMode(selectedMode); selectDestination({ ...favorite.destino, nombre: favorite.nombre || 'Destino favorito' }, selectedMode); }}><Bookmark size={12} />{favorite.nombre || 'Destino favorito'}</button>)}</div>}
    {destinationName && <p className="muted">Destino solicitado: {destinationName} · {modeLabels[mode]}</p>}
    {error && <div className="notice notice-error" role="alert">{error}{destCoords && <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => void handlePlan()}>Reintentar</button>}</div>}
    {busy && <p role="status" className="muted">Calculando alternativas… Se conserva el último resultado.</p>}
    <div className="route-results">{routes.map((route) => {
      const selected = activeRoute?.id === route.id;
      const risk = Number.isFinite(route.nivelRiesgo) ? Math.min(5, Math.max(0, Math.round(route.nivelRiesgo))) : null;
      return <article className={`card route-result ${selected ? 'selected' : ''}`} key={route.id}>
        <button type="button" className="route-select" onClick={() => { void triggerHaptic('light'); onSelectRoute(route); }} aria-pressed={selected}>
          <strong>{route.nombre || (route.tipo === 'segura' ? 'Más segura' : route.tipo === 'rapida' ? 'Más rápida' : 'Equilibrada')}</strong>
          <span className="badge" style={{ backgroundColor: route.riesgoConocido !== true || risk === null ? 'var(--surface-muted)' : RISK_COLORS[risk] }}>{route.riesgoConocido !== true || risk === null ? 'Riesgo sin verificar' : RISK_NAMES[risk]}</span>
          <span>{formatDistance(route.distancia)} · {formatDuration(route.duracion)} · {modeLabels[route.modo || mode]}</span>
        </button>
        {routeWarnings(route).map((warning) => <p key={warning} className="navigation-alert">{warning}</p>)}
        {selected && <div className="navigation-actions">
          <button type="button" className="btn btn-primary btn-small" disabled={busy || !isUsableFix(currentPosition)} onClick={() => onStartNavigation?.(route)}><Navigation size={14} />Iniciar recorrido</button>
          {usuario && <button type="button" className="btn btn-secondary btn-small" disabled={saving || busy} onClick={() => void saveFavorite(route)} aria-label="Guardar ruta en favoritos">{savedRoute === route.id ? <Check size={14} /> : <Bookmark size={14} />}{saving ? 'Guardando…' : 'Guardar'}</button>}
        </div>}
      </article>;
    })}</div>
    {!isUsableFix(currentPosition) && <p className="navigation-alert">Activa una ubicación GPS reciente para calcular o iniciar un recorrido.</p>}
  </div>;
};
