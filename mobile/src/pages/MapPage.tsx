import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MapView } from '../components/map/MapView';
import { RoutePlanner } from '../components/navigation/RoutePlanner';
import { IncidentDetailModal } from '../components/incident/IncidentDetailModal';
import { ChatBotModal } from '../components/chat/ChatBotModal';
import { useGeolocation } from '../hooks/useGeolocation';
import { useAuth } from '../hooks/useAuth';
import { errorMessage, onUnauthorized } from '../services/api';
import { triggerHaptic, onNetworkChange } from '../services/native';
import { NavigationService, isUsableFix, isNavigationAccountCurrent } from '../services/navigation';
import { DEFAULT_ICA_BOUNDS, expandMapBounds, getMapIncidents, getRecentIncidents, type MapBounds } from '../services/mapData';
import { MessageCircle, ChevronUp, ChevronDown } from 'lucide-react';
import type { Incidente, Ruta } from '../types';

interface MapPageProps { onGoReport: () => void; visible?: boolean; }

export const MapPage: React.FC<MapPageProps> = ({ visible = true }) => {
  const { usuario } = useAuth();
  const [incidents, setIncidents] = useState<Incidente[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incidente | null>(null);
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
  const refreshEnabled = visible || navigating;
  const [sheetOpen, setSheetOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [loadingIncidents, setLoadingIncidents] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  const [error, setError] = useState('');
  const [bounds, setBounds] = useState<MapBounds>(DEFAULT_ICA_BOUNDS);
  const [nearby, setNearby] = useState<Incidente[]>([]);
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

  useEffect(() => {
    historyRequests.current.forEach(controller => controller.abort());
    historyRequests.current.clear();
    navigationStarted.current = false;
    setHistoryError('');
    routeOwner.current = usuario?.id;
    setActiveRoute(null); setIsNavigating(false); setSheetOpen(true);
    setSelectedIncident(null); setChatOpen(false);
  }, [usuario?.id, usuario?.bloqueado]);

  useEffect(() => onUnauthorized(() => {
    historyRequests.current.forEach(controller => controller.abort());
    historyRequests.current.clear();
    navigationStarted.current = false;
    setHistoryError('');
    routeOwner.current = undefined;
    setActiveRoute(null); setIsNavigating(false); setSheetOpen(true);
    setSelectedIncident(null); setChatOpen(false);
  }), []);

  useEffect(() => { if (!visible) { setSelectedIncident(null); setChatOpen(false); } }, [visible]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current?.abort(); nearbyRequest.current?.abort(); historyRequests.current.forEach(controller => controller.abort()); historyRequests.current.clear(); };
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
    void triggerHaptic('medium');
    setActiveRoute(route); setIsNavigating(true); setSheetOpen(false);
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
    void triggerHaptic('medium');
    setIsNavigating(false); setActiveRoute(null); setSheetOpen(true);
  };

  return <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
    {visible && <MapView incidentes={incidents} ruta={displayedRoute} posicion={position} onSelectIncident={setSelectedIncident} onLocateMe={locate} locating={gpsLoading} onBoundsChange={onBoundsChange} refreshEnabled={refreshEnabled} />}
    <div className="map-data-status" aria-live="polite">
      {offline && <p>Sin conexión. Se conserva la última información disponible.</p>}
      {historyError && <p role="status">{historyError}</p>}
      {error && <p role="alert">{error} {lastUpdated ? 'Se conserva la última información.' : 'Aún no hay alertas cargadas.'}<button type="button" className="btn btn-small btn-secondary" disabled={loadingIncidents} onClick={() => void loadIncidents()}>Reintentar</button></p>}
      {loadingIncidents && <p role="status">{lastUpdated ? 'Actualizando alertas…' : 'Cargando alertas…'}</p>}
      {lastUpdated && (offline || error) && <small>Última actualización: {lastUpdated.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</small>}
      {gpsError && <p role="alert">GPS: {gpsError}<button type="button" className="btn btn-small btn-secondary" disabled={gpsLoading} onClick={() => void locate()}>Reintentar GPS</button></p>}
    </div>
    <button type="button" className={`chatbot-fab ${navigating ? 'chatbot-fab-navigating' : ''}`} onClick={() => { void triggerHaptic('light'); setChatOpen(true); }} aria-label="Abrir asistente de ayuda CiviGo"><MessageCircle size={24} /></button>
    <div className={`map-bottom-sheet ${navigating ? 'map-bottom-sheet-navigating' : ''}`} style={{ transform: navigating || sheetOpen ? 'translateY(0)' : 'translateY(calc(100% - 60px))', paddingBottom: 'calc(12px + var(--safe-bottom))' }}>
      <button type="button" className="map-sheet-toggle" onClick={toggleSheet} aria-expanded={sheetOpen} aria-controls="map-route-panel" aria-label={sheetOpen ? 'Mostrar navegación compacta' : 'Ampliar rutas y condiciones'}>
        <span className="eyebrow">{navigating ? 'NAVEGACIÓN' : 'RUTAS Y CONDICIONES'}</span><span className="badge">{incidents.length} alertas</span>{sheetOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      </button>
      <div id="map-route-panel" hidden={!navigating && !sheetOpen}>
        <RoutePlanner currentPosition={position} onSelectRoute={(route) => { routeOwner.current = usuario?.id; setActiveRoute(route); }} activeRoute={displayedRoute} onStartNavigation={handleStartNav} onStopNavigation={handleStopNav} isNavigating={navigating} compact={!sheetOpen} />
        {sheetOpen && <details className="nearby-incidents">
          <summary>Recientes cerca de ti · hasta 10 en 1 km</summary>
          {!isUsableFix(position) && <p className="muted">Activa una ubicación GPS reciente para actualizar los incidentes cercanos.</p>}
          {nearbyLoading && <p role="status">Actualizando incidentes cercanos…</p>}
          {nearbyError && <p className="navigation-alert" role="alert">{nearbyError} Se conserva la última consulta.<button type="button" className="btn btn-small btn-secondary" disabled={nearbyLoading} onClick={() => void loadNearby()}>Reintentar</button></p>}
          {nearbyUpdated && <small className="muted">Última consulta: {nearbyUpdated.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</small>}
          {nearbyUpdated && !nearbyLoading && nearby.length === 0 && <p className="muted">No hay incidentes recientes publicados dentro de 1 km.</p>}
          {nearby.map((incident) => <button key={incident.id} type="button" className="nearby-incident" onClick={() => setSelectedIncident(incident)}><strong>{incident.tipoNombre || incident.tipo}</strong><span>{incident.descripcion || 'Ver detalles del incidente'}</span></button>)}
        </details>}
      </div>
    </div>
    {selectedIncident && <IncidentDetailModal incidente={selectedIncident} onClose={() => setSelectedIncident(null)} onRefresh={loadIncidents} />}
    <ChatBotModal isOpen={chatOpen} onClose={() => setChatOpen(false)} />
  </div>;
};
