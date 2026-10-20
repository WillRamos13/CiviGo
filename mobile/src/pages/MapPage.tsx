import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { filterIncidentsByYears, incidentYearOptions, type IncidentYears } from '../services/incidentYears';
import { MapView } from '../components/map/MapView';
import { MapStatusNotice } from '../components/map/MapStatusNotice';
import { RoutePlanner } from '../components/navigation/RoutePlanner';
import { IncidentDetailModal } from '../components/incident/IncidentDetailModal';
import { NearbyIncidentCards } from '../components/incident/NearbyIncidentCards';
import { ChatBotModal } from '../components/chat/ChatBotModal';
import { useGeolocation } from '../hooks/useGeolocation';
import { useAuth } from '../hooks/useAuth';
import { errorMessage, onUnauthorized } from '../services/api';
import { triggerHaptic, onNetworkChange, StorageService } from '../services/native';
import { useAppActivity } from '../hooks/useAppActivity';
import { ActiveTripController } from '../services/activeTrip';
import { NavigationService, isUsableFix, isNavigationAccountCurrent } from '../services/navigation';
import { DEFAULT_ICA_BOUNDS, expandMapBounds, getMapIncidents, getRecentIncidents, type MapBounds } from '../services/mapData';
import { MessageCircle, ChevronUp, ChevronDown, Layers, MapPinPlus } from 'lucide-react';
import { AvatarPicker } from '../components/map/NavigationAvatar';
import { NavigationAvatarPreferenceController, DEFAULT_NAVIGATION_AVATAR, type NavigationAvatar } from '../services/navigationAvatar';
import type { Incidente, Ruta, Posicion } from '../types';

interface MapPageProps { onGoReport: () => void; visible?: boolean; onNavigationChange?: (active: boolean) => void; }

export const MapPage: React.FC<MapPageProps> = ({ visible = true, onGoReport, onNavigationChange }) => {
  const { usuario, loading: sessionLoading } = useAuth();
  const foreground = useAppActivity();
  const [incidents, setIncidents] = useState<Incidente[]>([]);
  const [selectedYears, setSelectedYears] = useState<IncidentYears>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incidente | null>(null);
  const [focusedLocation, setFocusedLocation] = useState<Posicion | null>(null);
  const [activeRoute, setActiveRoute] = useState<Ruta | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const navigationStarted = useRef(false);
  const historyRequest = useRef<AbortController | null>(null);
  const historyRequests = useRef(new Set<AbortController>());
  const [historyError, setHistoryError] = useState('');
  const { position, loading: gpsLoading, error: gpsError, locate } = useGeolocation(visible || isNavigating);
  const routeOwner = useRef(usuario?.id);
  const currentRouteAccount = isNavigationAccountCurrent(routeOwner.current, usuario);
  const navigating = isNavigating && currentRouteAccount;
  const displayedRoute = currentRouteAccount ? activeRoute : null;
  const refreshEnabled = foreground && (visible || navigating);
  const tripController = useRef<ActiveTripController | null>(null);
  if (!tripController.current) tripController.current = new ActiveTripController(StorageService);
  tripController.current.setOwner(usuario && !usuario.bloqueado ? usuario.id : null);
  const previousTripOwner = useRef<number | null>(null);
  const tripSnapshot = useRef<{ ownerId: number; route: Ruta; covered: number; startedAt: number } | null>(null);
  const currentTripOwner = useRef<number | null>(null);
  currentTripOwner.current = usuario && !usuario.bloqueado ? usuario.id : null;
  const lastTripWrite = useRef(0);
  const [restoredProgress, setRestoredProgress] = useState(0);
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [tripSaveError, setTripSaveError] = useState('');
  const [sheetOpen, setSheetOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const avatarPreference = useRef<NavigationAvatarPreferenceController | null>(null);
  const avatarOwner = useRef<number | null>(usuario?.id ?? null);
  avatarOwner.current = usuario?.id ?? null;
  if (!avatarPreference.current) avatarPreference.current = new NavigationAvatarPreferenceController();
  avatarPreference.current.setOwner(usuario?.id ?? null);
  const [avatarState, setAvatarState] = useState<{ owner: number | null; value: NavigationAvatar }>({ owner: null, value: DEFAULT_NAVIGATION_AVATAR });
  const navigationAvatar = avatarState.owner === (usuario?.id ?? null) ? avatarState.value : DEFAULT_NAVIGATION_AVATAR;
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [recenterNonce, setRecenterNonce] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(60);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [loadingIncidents, setLoadingIncidents] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  const [error, setError] = useState('');
  const [bounds, setBounds] = useState<MapBounds>(DEFAULT_ICA_BOUNDS);
  const [nearby, setNearby] = useState<Incidente[]>([]);
  const years = useMemo(() => incidentYearOptions([...incidents,...nearby], selectedYears), [incidents, nearby, selectedYears]);
  const visibleIncidents = useMemo(() => filterIncidentsByYears(incidents, selectedYears), [incidents, selectedYears]);
  const visibleNearby = useMemo(() => {
    if(selectedYears === null || !isUsableFix(position)) return filterIncidentsByYears(nearby,selectedYears);
    const publishedAt=(item:Incidente)=>{const value=Date.parse(item.fechaPublicacion||item.fechaCreacion||item.creadoEn||'');return Number.isFinite(value)?value:0;};
    return filterIncidentsByYears([...nearby,...incidents],selectedYears).sort((a,b)=>publishedAt(b)-publishedAt(a)||b.id-a.id);
  }, [nearby, incidents, selectedYears, position]);
  const [nearbyError, setNearbyError] = useState('');
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyUpdated, setNearbyUpdated] = useState<Date | null>(null);
  const mounted = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const nearbyRequest = useRef<AbortController | null>(null);
  const latestPosition = useRef(position);
  latestPosition.current = position;
  const nearbyLocationKey = position ? `${position.latitud.toFixed(3)},${position.longitud.toFixed(3)}` : '';
  const onBoundsChange = useCallback((value: MapBounds) => setBounds((previous) => expandMapBounds(previous, value)), []);

  const persistTrip = useCallback((force = false) => {
    const trip = tripSnapshot.current;
    if (!trip || trip.ownerId !== currentTripOwner.current || (!force && Date.now() - lastTripWrite.current < 5000)) return;
    const owner = routeOwner.current;
    lastTripWrite.current = Date.now();
    void tripController.current!.save(trip.route, trip.covered, trip.startedAt).then(saved => {
      if (mounted.current && saved && routeOwner.current === owner) setTripSaveError('');
    }).catch(() => {
      if (mounted.current && routeOwner.current === owner) setTripSaveError('No se pudo guardar la recuperación del recorrido en este dispositivo.');
    });
  }, []);
  const handleProgressChange = useCallback((covered: number) => {
    if (!tripSnapshot.current || !Number.isFinite(covered)) return;
    tripSnapshot.current.covered = covered;
    persistTrip();
  }, [persistTrip]);
  useEffect(() => {
    if (!foreground) persistTrip(true);
  }, [foreground, persistTrip]);
  useEffect(() => {
    if (!navigating || !activeRoute) return;
    if (tripSnapshot.current?.route !== activeRoute) {
      tripSnapshot.current = { ownerId: currentTripOwner.current!, route: activeRoute, covered: 0, startedAt: tripSnapshot.current?.startedAt ?? Date.now() };
      setRestoredProgress(0);
    }
    persistTrip(true);
  }, [activeRoute, navigating, persistTrip]);

  useEffect(() => { onNavigationChange?.(navigating); }, [navigating, onNavigationChange]);
  useEffect(() => () => onNavigationChange?.(false), [onNavigationChange]);
  useEffect(() => {
    let active = true;
    const owner = usuario?.id ?? null;
    setAvatarError(''); setAvatarSaving(false);
    void avatarPreference.current!.load().then(value => {
      if (active && value !== null) setAvatarState({ owner, value });
    }).catch(() => { if (active) setAvatarState({ owner, value: DEFAULT_NAVIGATION_AVATAR }); });
    return () => { active = false; };
  }, [usuario?.id]);
  const saveAvatar = async (value: NavigationAvatar) => {
    if (avatarSaving || !usuario) return;
    const owner = usuario.id;
    setAvatarSaving(true); setAvatarError('');
    try {
      const saved = await avatarPreference.current!.save(value);
      if (saved && avatarOwner.current === owner) setAvatarState({ owner, value });
    } catch { if (avatarOwner.current === owner) setAvatarError('No se pudo guardar el icono del recorrido. Inténtalo de nuevo.'); }
    finally { if (avatarOwner.current === owner) setAvatarSaving(false); }
  };

  useLayoutEffect(() => {
    // Start each panel mode at its heading, even after choosing a lower card.
    // Otherwise a retained scroll position can hide the next turn under it.
    if (sheetRef.current) sheetRef.current.scrollTop = 0;
  }, [navigating, sheetOpen]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const measure = () => setSheetHeight(!navigating && !sheetOpen ? 60 : Math.ceil(sheet.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [sheetOpen, navigating, visible]);

  useEffect(() => {
    if (sessionLoading) return;
    const owner = usuario && !usuario.bloqueado ? usuario.id : null;
    const previous = previousTripOwner.current;
    previousTripOwner.current = owner;
    if (previous !== null && previous !== owner) void tripController.current!.clear(previous).catch(() => {});
    if (owner !== null && previous === owner && navigationStarted.current && routeOwner.current === owner) return;
    let current = true;
    historyRequests.current.forEach(controller => controller.abort());
    historyRequests.current.clear();
    navigationStarted.current = false;
    tripSnapshot.current = null;
    setRestoredProgress(0); setRecoveryNotice(''); setTripSaveError('');
    setHistoryError('');
    routeOwner.current = usuario?.id;
    setActiveRoute(null); setIsNavigating(false); setSheetOpen(true);
    setSelectedIncident(null); setFocusedLocation(null); setChatOpen(false); setLayersOpen(false);
    if (owner !== null) void tripController.current!.load().then(trip => {
      if (!current || !trip || navigationStarted.current) return;
      const recoveredRoute = { ...trip.route, copiaGuardada: true };
      tripSnapshot.current = { ownerId: owner, route: recoveredRoute, covered: trip.covered, startedAt: trip.startedAt };
      navigationStarted.current = true;
      routeOwner.current = owner;
      setRestoredProgress(trip.covered);
      setActiveRoute(recoveredRoute); setIsNavigating(true); setSheetOpen(false);
      setRecoveryNotice('Recorrido recuperado. La navegación se actualizará con una ubicación GPS reciente.');
    }).catch(() => { if (current) setTripSaveError('No se pudo leer el recorrido guardado en este dispositivo.'); });
    return () => { current = false; };
  }, [usuario?.id, usuario?.bloqueado, sessionLoading]);

  useEffect(() => onUnauthorized(() => {
    historyRequests.current.forEach(controller => controller.abort());
    historyRequests.current.clear();
    navigationStarted.current = false;
    void tripController.current!.clear().catch(() => {});
    tripController.current!.setOwner(null);
    tripSnapshot.current = null;
    setRestoredProgress(0); setRecoveryNotice(''); setTripSaveError('');
    setHistoryError('');
    routeOwner.current = undefined;
    setActiveRoute(null); setIsNavigating(false); setSheetOpen(true);
    setSelectedIncident(null); setFocusedLocation(null); setChatOpen(false); setLayersOpen(false);
  }), []);

  useEffect(() => { if (!visible) { setSelectedIncident(null); setChatOpen(false); } }, [visible]);

  useEffect(() => {
    mounted.current = true;
    return () => { persistTrip(true); mounted.current = false; pending.current?.abort(); nearbyRequest.current?.abort(); historyRequests.current.forEach(controller => controller.abort()); historyRequests.current.clear(); };
  }, []);

  const loadIncidents = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoadingIncidents(true);
    try {
      const data = await getMapIncidents(bounds, controller.signal);
      if (!mounted.current || controller.signal.aborted || pending.current !== controller) return;
      setIncidents(data);
      setSelectedIncident((selected) => selected ? data.find((incident) => incident.id === selected.id) || null : null);
      setLastUpdated(new Date());
      setError('');
    } catch (err) {
      if (mounted.current && !controller.signal.aborted && pending.current === controller) setError(errorMessage(err));
    } finally {
      if (mounted.current && pending.current === controller) setLoadingIncidents(false);
    }
  }, [bounds]);

  const loadNearby = useCallback(async () => {
    const fix = latestPosition.current;
    if (!isUsableFix(fix)) return;
    nearbyRequest.current?.abort();
    const controller = new AbortController();
    nearbyRequest.current = controller;
    setNearbyLoading(true);
    try {
      const items = await getRecentIncidents(fix, controller.signal);
      if (!mounted.current || controller.signal.aborted || nearbyRequest.current !== controller) return;
      setNearby(items); setNearbyError(''); setNearbyUpdated(new Date());
    } catch (err) {
      if (mounted.current && !controller.signal.aborted && nearbyRequest.current === controller) setNearbyError(errorMessage(err));
    } finally {
      if (mounted.current && nearbyRequest.current === controller) setNearbyLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!refreshEnabled) return;
    void loadNearby();
    return () => nearbyRequest.current?.abort();
  }, [nearbyLocationKey, loadNearby, refreshEnabled]);

  useEffect(() => {
    if (!refreshEnabled) return;
    void loadIncidents();
    const interval = setInterval(() => { if (navigator.onLine) { void loadIncidents(); void loadNearby(); } }, 30000);
    const unsubscribe = onNetworkChange((status) => {
      if (!mounted.current) return;
      setOffline(!status.connected);
      if (status.connected) { void loadIncidents(); void loadNearby(); }
      else { pending.current?.abort(); nearbyRequest.current?.abort(); setLoadingIncidents(false); setNearbyLoading(false); }
    });
    return () => { pending.current?.abort(); clearInterval(interval); unsubscribe(); };
  }, [loadIncidents, loadNearby, refreshEnabled]);

  const toggleSheet = () => { void triggerHaptic('light'); setSheetOpen((open) => !open); };
  const handleStartNav = (route: Ruta) => {
    if (!usuario || usuario.bloqueado || navigationStarted.current) return;
    navigationStarted.current = true;
    routeOwner.current = usuario.id;
    tripSnapshot.current = { ownerId: usuario.id, route, covered: 0, startedAt: Date.now() };
    setRestoredProgress(0); setRecoveryNotice('');
    setFocusedLocation(null);
    persistTrip(true);
    void triggerHaptic('medium');
    setActiveRoute(route); setIsNavigating(true); setSheetOpen(false); setLayersOpen(false);
    // One write when starting a trip, never for a GPS update or an automatic reroute.
    const controller = new AbortController();
    historyRequest.current = controller;
    historyRequests.current.add(controller);
    setHistoryError('');
    void NavigationService.recordHistory(route, route.origen, route.destino, route.modo, controller.signal)
      .catch((err) => {
        if (mounted.current && !controller.signal.aborted && historyRequest.current === controller) {
          setHistoryError(`No se pudo guardar el recorrido en tu historial: ${errorMessage(err)}`);
        }
      }).finally(() => historyRequests.current.delete(controller));
  };
  const handleStopNav = () => {
    navigationStarted.current = false;
    tripSnapshot.current = null;
    void tripController.current!.clear().catch(() => {});
    setRestoredProgress(0); setRecoveryNotice(''); setTripSaveError('');
    void triggerHaptic('medium');
    setIsNavigating(false); setActiveRoute(null); setSheetOpen(true); setLayersOpen(false);
  };

  return <div className={`map-mobile-screen ${navigating ? 'map-navigation-active' : ''}`} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', '--map-sheet-height': `${sheetHeight}px` } as React.CSSProperties}>
    {visible && <MapView incidentes={visibleIncidents} yearFilter={{options: years, selected: selectedYears, onChange: value => {setSelectedYears(value); setSelectedIncident(null);}}} ruta={displayedRoute} posicion={position} onSelectIncident={setSelectedIncident} onLocateMe={() => { setFocusedLocation(null); return locate(); }} locating={gpsLoading} onBoundsChange={onBoundsChange} refreshEnabled={refreshEnabled} following={navigating} recenterNonce={recenterNonce} onLayersOpen={() => setSheetOpen(false)} navigationMode={navigating} navigationExpanded={sheetOpen} layersOpen={layersOpen} onLayersOpenChange={setLayersOpen} navigationAvatar={navigationAvatar} restoredProgress={restoredProgress} focusedLocation={focusedLocation} statusNotices={<>
      {offline && <MapStatusNotice title="Sin conexión" retryDisabled={loadingIncidents} retryLabel="Reintentar alertas" onRetry={() => void loadIncidents()}><p>Se conserva la última información disponible.{!lastUpdated ? ' Aún no hay alertas cargadas.' : ''}</p>{error && <p>Consulta de alertas: {error}</p>}{lastUpdated && <small>Última actualización: {lastUpdated.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</small>}</MapStatusNotice>}
      {historyError && (!navigating || sheetOpen) && <MapStatusNotice title="Historial sin guardar"><p>{historyError}</p></MapStatusNotice>}
      {!offline && error && <MapStatusNotice title="Alertas sin actualizar" retryDisabled={loadingIncidents} retryLabel="Reintentar alertas" onRetry={() => void loadIncidents()}><p>{error} {lastUpdated ? 'Se conserva la última información.' : 'Aún no hay alertas cargadas.'}</p>{lastUpdated && <small>Última actualización: {lastUpdated.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</small>}</MapStatusNotice>}
      {loadingIncidents && !lastUpdated && <span className="map-loading-chip" role="status">Cargando alertas…</span>}
      {gpsError && !navigating && <MapStatusNotice title="GPS no disponible" retryDisabled={gpsLoading} retryLabel="Reintentar GPS" onRetry={() => void locate()}><p>{gpsError}</p></MapStatusNotice>}
    </>} />}
    <button type="button" className={`chatbot-fab ${navigating ? 'chatbot-fab-navigating' : ''}`} onClick={() => { void triggerHaptic('light'); setChatOpen(true); }} aria-label="Abrir asistente de ayuda CiviGo"><MessageCircle size={24} /></button>
    <div ref={sheetRef} className={`map-bottom-sheet ${navigating ? 'map-bottom-sheet-navigating' : ''} ${!sheetOpen ? 'map-bottom-sheet-compact' : ''}`} data-expanded={sheetOpen} style={{ transform: navigating || sheetOpen ? 'translateY(0)' : 'translateY(calc(100% - 60px))', paddingBottom: 'calc(12px + var(--safe-bottom))' }}>
      <button type="button" className="map-sheet-toggle" onClick={toggleSheet} aria-expanded={sheetOpen} aria-controls="map-route-panel" aria-label={navigating ? sheetOpen ? 'Contraer opciones de navegación' : 'Expandir opciones de navegación' : sheetOpen ? 'Mostrar navegación compacta' : 'Ampliar rutas y condiciones'}>
        <span className="eyebrow">{navigating ? sheetOpen ? 'OPCIONES DEL RECORRIDO' : 'EN CAMINO' : '¿A DÓNDE VAMOS?'}</span>{!navigating && <span className="badge">{visibleIncidents.length} en mapa</span>}{sheetOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      <div id="map-route-panel" hidden={!navigating && !sheetOpen}>
        <RoutePlanner currentPosition={position} onSelectRoute={(route) => { routeOwner.current = usuario?.id; if (navigating && route !== activeRoute) setRestoredProgress(0); setActiveRoute(route); }} activeRoute={displayedRoute} onStartNavigation={handleStartNav} onStopNavigation={handleStopNav} isNavigating={navigating} compact={!sheetOpen} restoredProgress={restoredProgress} onProgressChange={handleProgressChange} onShowPlace={place => { setFocusedLocation({latitud:place.latitud,longitud:place.longitud}); setSheetOpen(false); }} onRecenter={() => { setFocusedLocation(null); setRecenterNonce(value => value + 1); void triggerHaptic('light'); }} />
        {navigating && sheetOpen && <section className="navigation-trip-options" aria-label="Opciones del recorrido">
          {recoveryNotice && <p className="navigation-alert" role="status">{recoveryNotice}</p>}
          {tripSaveError && <p className="navigation-alert" role="status">{tripSaveError}</p>}
          <div className="navigation-trip-shortcuts">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => { setLayersOpen(false); setSheetOpen(false); onGoReport(); }}><MapPinPlus size={17} aria-hidden="true" />Agregar aviso</button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setLayersOpen(true)}><Layers size={17} aria-hidden="true" />Cambiar capas</button>
          </div>
          <AvatarPicker value={navigationAvatar} onChange={value => void saveAvatar(value)} disabled={avatarSaving || !usuario} />
          {avatarError && <p className="navigation-alert" role="status">{avatarError}</p>}
          {gpsError && <MapStatusNotice title="GPS no disponible" retryDisabled={gpsLoading} retryLabel="Reintentar GPS" onRetry={() => void locate()}><p>{gpsError}</p></MapStatusNotice>}
        </section>}
        {sheetOpen && !navigating && <NearbyIncidentCards incidents={visibleNearby} loading={nearbyLoading} error={nearbyError} updatedAt={nearbyUpdated} position={position} onSelect={incident => { setFocusedLocation(incident); setSelectedIncident(incident); }} onRefresh={() => void loadNearby()} />}
      </div>
    </div>
    {selectedIncident && <IncidentDetailModal incidente={selectedIncident} onClose={() => setSelectedIncident(null)} onRefresh={loadIncidents} />}
    <ChatBotModal isOpen={chatOpen} onClose={() => setChatOpen(false)} />
  </div>;
};
