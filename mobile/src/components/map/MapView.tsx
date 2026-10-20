import React, { useEffect, useRef, useState, useMemo, useId } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Locate, Compass, Layers, ChevronDown, X } from 'lucide-react';
import { triggerHaptic, onNetworkChange } from '../../services/native';
import { errorMessage } from '../../services/api';
import { updateIncidentMarker } from './incidentMarker';
import { RISK_COLORS } from '../../types';
import type { Incidente, Ruta, Posicion, LocationFix } from '../../types';
import { RiskLegend, TrafficLegend } from './RiskLegend';
import { NavigationService, isPosition, isUsableFix } from '../../services/navigation';
import { applyRoadRisk, type RoadGeometry } from '../../services/roadMap';
import { isInMarkerViewport, type MapBounds } from '../../services/mapData';
import { bindIncidentMarkerZoom, filterMapIncidents, incidentTypeKey, syncTrafficLayer, TRAFFIC_SOURCE_ID } from '../../services/mapLayers';
import { getTrafficStatus, getTrafficIncidents, trafficAvailable, trafficFlowMessage, trafficTileUrl,
  type TrafficStatus, type TrafficResponse, type ExternalTrafficIncident } from '../../services/traffic';
import { getIncidentIconPath } from '../../services/incidentIcons';
import { useDialog } from '../../hooks/useDialog';
import { updateNavigationAvatarMarker, type NavigationAvatar } from '../../services/navigationAvatar';
import { useTheme } from '../../hooks/useTheme';
import { useAppActivity } from '../../hooks/useAppActivity';
import { MapRecoveryController } from '../../services/mapRecovery';
import { CiviGoMapTheme } from '../../services/mapTheme';
import { RouteProgressTracker, getNavigationRouteLines } from '../../services/navigationProgress';
import { MapStatusNotice } from './MapStatusNotice';
import './map-glass.css';

// Official CiviGo Mapbox Token
const MAPBOX_TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN ||
  import.meta.env.VITE_PUBLIC_MAPBOX_TOKEN ||
  'pk.eyJ1Ijoid2lsbDEzMDgwNSIsImEiOiJjbXVrdzRoOWsxNm1nMzVvZHlnMnlrb2cyIn0.d1Cl3QbATDi_qDbfknQwXw';

interface MapViewProps {
  incidentes?: Incidente[];
  ruta?: Ruta | null;
  posicion?: LocationFix | null;
  editor?: boolean;
  onSelectIncident?: (incidente: Incidente) => void;
  onSelectCoordinates?: (pos: Posicion) => void;
  onLocateMe?: () => Promise<LocationFix | null> | LocationFix | null;
  locating?: boolean;
  onBoundsChange?: (bounds: MapBounds) => void;
  refreshEnabled?: boolean;
  following?: boolean;
  recenterNonce?: number;
  onLayersOpen?: () => void;
  navigationMode?: boolean;
  navigationExpanded?: boolean;
  layersOpen?: boolean;
  onLayersOpenChange?: (open: boolean) => void;
  navigationAvatar?: NavigationAvatar;
  restoredProgress?: number;
  focusedLocation?: Posicion | null;
  statusNotices?: React.ReactNode;
}


export const MapView: React.FC<MapViewProps> = ({
  incidentes = [],
  ruta = null,
  posicion = null,
  editor = false,
  onSelectIncident,
  onSelectCoordinates,
  onLocateMe,
  locating = false,
  onBoundsChange,
  refreshEnabled = true,
  following = false,
  recenterNonce = 0,
  onLayersOpen,
  navigationMode = false,
  navigationExpanded = false,
  layersOpen,
  onLayersOpenChange,
  navigationAvatar = 'arrow',
  restoredProgress = 0,
  focusedLocation = null,
  statusNotices,
}) => {
  const { isDark, preference, setThemePreference } = useTheme();
  const appActive = useAppActivity();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<number, mapboxgl.Marker>>(new Map());
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const editorMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const focusedMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const focusRequestRef = useRef<Posicion | null>(null);
  const pendingFocus = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [recoveringContext, setRecoveringContext] = useState(false);
  const recoveryRef = useRef<MapRecoveryController | null>(null);
  const contextMissing = useRef(false);
  const automaticMapRebuilds = useRef(0);
  const mapTheme = useRef<CiviGoMapTheme | null>(null);
  const themeRef = useRef(isDark); themeRef.current = isDark;
  const appActiveRef = useRef(appActive); appActiveRef.current = appActive;
  const savedCamera = useRef<{ center: [number, number]; zoom: number; bearing: number; pitch: number } | null>(null);
  const routeTracker = useRef(new RouteProgressTracker());
  const trackedRoute = useRef<Ruta | null>(null);
  const routeProgress = useMemo(() => {
    if (!ruta || !following) { trackedRoute.current = null; routeTracker.current.reset(); return null; }
    if (trackedRoute.current !== ruta) { routeTracker.current.seed(ruta, restoredProgress); trackedRoute.current = ruta; }
    return routeTracker.current.update(ruta, posicion);
  }, [ruta, following, posicion, restoredProgress]);
  const [showRisks, setShowRisks] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showTraffic, setShowTraffic] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [localLayersOpen, setLocalLayersOpen] = useState(false);
  const effectiveLayersOpen = layersOpen ?? localLayersOpen;
  const currentLayersOpen = useRef(effectiveLayersOpen);
  currentLayersOpen.current = effectiveLayersOpen;
  const changeLayersOpen = (open: boolean) => {
    if (currentLayersOpen.current === open) return;
    currentLayersOpen.current = open;
    setLocalLayersOpen(open);
    onLayersOpenChange?.(open);
    if (open && !navigationMode) onLayersOpen?.();
  };
  const layersDialogRef = useDialog<HTMLDivElement>(navigationMode && effectiveLayersOpen, () => changeLayersOpen(false));
  const layersTitleId = useId();
  const typeFilterId = useId();
  const themePreferenceId = useId();
  const [markerZoomVisible, setMarkerZoomVisible] = useState(false);
  const filteredIncidents = useMemo(() => filterMapIncidents(incidentes, typeFilter), [incidentes, typeFilter]);
  const typeOptions = useMemo(() => {
    const options = new Map<string, string>();
    incidentes.forEach(incident => options.set(incidentTypeKey(incident), incident.tipoNombre || incident.tipo));
    if (typeFilter && !options.has(typeFilter)) options.set(typeFilter, typeFilter.replace(/-/g, ' '));
    return [...options].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [incidentes, typeFilter]);
  const [mapError, setMapError] = useState('');
  const [roadError, setRoadError] = useState('');
  const [loadingRoads, setLoadingRoads] = useState(false);
  const [reload, setReload] = useState(0);
  const [roadReload, setRoadReload] = useState(0);
  const [trafficReload, setTrafficReload] = useState(0);
  const [trafficStatus, setTrafficStatus] = useState<TrafficStatus | null>(null);
  const [trafficData, setTrafficData] = useState<TrafficResponse | null>(null);
  const [trafficError, setTrafficError] = useState('');
  const [trafficTileError, setTrafficTileError] = useState('');
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [trafficRevision, setTrafficRevision] = useState(0);
  const [trafficLoadedAt, setTrafficLoadedAt] = useState<number | null>(null);
  const [externalSelected, setExternalSelected] = useState<ExternalTrafficIncident | null>(null);
  const externalMarkers = useRef(new Map<string, mapboxgl.Marker>());
  const lastTrafficDiagnostic = useRef(0);
  const followCamera = useRef(following);
  const followRequest = useRef({ following, recenterNonce });
  const cameraState = useRef({ following, posicion, navigationAvatar });
  cameraState.current = { following, posicion, navigationAvatar };
  const tileUrl = useMemo(() => {
    try { return trafficTileUrl(trafficRevision); } catch { return ''; }
  }, [trafficRevision]);
  const trafficReady = trafficAvailable(trafficStatus) && Boolean(tileUrl);
  const [markerBounds, setMarkerBounds] = useState<MapBounds | null>(null);
  const locateAttempt = useRef(0);
  const coordinatesCallback = useRef(onSelectCoordinates);
  coordinatesCallback.current = onSelectCoordinates;
  const boundsCallback = useRef(onBoundsChange);
  boundsCallback.current = onBoundsChange;
  const [roadFeatures, setRoadFeatures] = useState<GeoJSON.FeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  });
  const roadCache = useRef<RoadGeometry | null>(null);
  const roadRevision = useRef<string>('');

  // JSON uses the native API transport; raster tiles use only our HTTPS proxy.
  useEffect(() => {
    if (editor || !refreshEnabled || !appActive) return;
    let active = true;
    let pending: AbortController | null = null;
    if (!showTraffic) { setTrafficData(null); setExternalSelected(null); }
    const load = async () => {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      setTrafficLoading(true);
      let statusReceived = false;
      try {
        const status = await getTrafficStatus(controller.signal);
        if (!active || controller.signal.aborted || pending !== controller) return;
        statusReceived = true;
        setTrafficStatus(status);
        // Also refresh failed cached tiles when reconnecting within one bucket.
        setTrafficRevision(previous => Math.max(previous + 1, Math.floor(Date.now() / 120000)));
        setTrafficError('');
        if (!showTraffic || !status.configurado || !status.habilitado || !status.controlCuotaDisponible) {
          setTrafficData(null); setExternalSelected(null); return;
        }
        const data = await getTrafficIncidents(controller.signal);
        if (!active || controller.signal.aborted || pending !== controller) return;
        setTrafficData(data);
        setExternalSelected(current => current ? data.incidentes.find(item => item.id === current.id) ?? null : null);
      } catch (error) {
        if (active && !controller.signal.aborted && pending === controller) {
          setExternalSelected(null);
          if (!statusReceived) {
            setTrafficStatus(null); setTrafficData(null); setTrafficError(errorMessage(error));
          } else {
            setTrafficData({ incidentes: [], trafico: { disponible: false, fuente: null, actualizadoEn: null,
              motivo: 'No se pudieron actualizar los avisos de tráfico. Reintentaremos automáticamente.' } });
          }
        }
      } finally {
        if (active && pending === controller) setTrafficLoading(false);
      }
    };
    void load();
    const interval = setInterval(load, 120000);
    const unsubscribe = onNetworkChange(status => {
      if (!active) return;
      if (status.connected) void load();
      else {
        pending?.abort(); setTrafficStatus(null); setTrafficData(null); setExternalSelected(null);
        setTrafficLoading(false); setTrafficError('Sin conexión. El tráfico no se puede actualizar.');
      }
    });
    return () => { active = false; pending?.abort(); clearInterval(interval); unsubscribe(); };
  }, [editor, refreshEnabled, trafficReload, showTraffic, appActive]);

  // Fetch live road risk data for Ica
  useEffect(() => {
    if (editor || !refreshEnabled || !appActive) return;
    let active = true;
    let pending: AbortController | null = null;

    const loadRoads = async () => {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      setLoadingRoads(true);
      try {
        const riskData = await NavigationService.getRoadRisks(controller.signal);
        let geometry = roadCache.current;
        if (!geometry || geometry.version !== riskData.version) {
          geometry = await NavigationService.getRoadGeometry(riskData.version, controller.signal);
        }
        if (!active || controller.signal.aborted || pending !== controller) return;
        if (geometry && (roadCache.current !== geometry || roadRevision.current !== riskData.revision)) {
          const styled = applyRoadRisk(geometry, riskData);
          roadCache.current = geometry;
          roadRevision.current = riskData.revision;
          setRoadFeatures(styled);
        }
        setRoadError('');
      } catch (error) {
        if (active && !controller.signal.aborted && pending === controller) setRoadError(errorMessage(error));
      } finally {
        if (active && pending === controller) setLoadingRoads(false);
      }
    };

    void loadRoads();
    const interval = setInterval(loadRoads, 30000);
    const unsubscribe = onNetworkChange((status) => { if (active && status.connected) void loadRoads(); });
    return () => {
      active = false;
      pending?.abort();
      clearInterval(interval);
      unsubscribe();
    };
  }, [editor, roadReload, refreshEnabled, appActive]);

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current) return;
    let active = true;
    setMapLoaded(false);
    contextMissing.current = false;
    setRecoveringContext(false);
    setMapError('');
    setTrafficLoadedAt(null);
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const initialCenter: [number, number] = isPosition(posicion)
      ? [posicion.longitud, posicion.latitud]
      : [-75.7286, -14.0678]; // Ica, Perú

    let map: mapboxgl.Map;
    try { map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: savedCamera.current?.center ?? initialCenter,
      zoom: savedCamera.current?.zoom ?? (editor ? 16 : 13.5),
      bearing: savedCamera.current?.bearing ?? 0,
      pitch: savedCamera.current?.pitch ?? 0,
      attributionControl: false,
      // Bound off-screen tile retention on phones; visible tiles still load.
      maxTileCacheSize: 32,
      fadeDuration: 0,
    }); } catch {
      setMapError('No se pudo iniciar el mapa en este dispositivo.');
      return;
    }
    mapTheme.current = new CiviGoMapTheme();
    const recovery = new MapRecoveryController({
      lost: () => { if (active) { contextMissing.current = true; setRecoveringContext(true); setMapLoaded(false); setMapError(''); } },
      restored: () => {
        if (!active) return;
        contextMissing.current = false; automaticMapRebuilds.current = 0;
        map.resize(); map.triggerRepaint();
        setRecoveringContext(false); setMapLoaded(Boolean(map.getSource('route-source')));
      },
      rebuild: () => {
        if (!active) return;
        if (automaticMapRebuilds.current < 2) { automaticMapRebuilds.current++; setReload(value => value + 1); }
        else { setRecoveringContext(false); setMapError('El dispositivo no pudo recuperar el mapa. El recorrido se conserva; puedes reintentar.'); }
      },
    });
    recovery.setForeground(appActiveRef.current);
    recoveryRef.current = recovery;
    const contextLost = (event: { originalEvent?: Event }) => { event.originalEvent?.preventDefault(); recovery.contextLost(); };
    const contextRestored = () => recovery.contextRestored();
    map.on('webglcontextlost', contextLost);
    map.on('webglcontextrestored', contextRestored);
    const stopMarkerZoom = bindIncidentMarkerZoom(map, setMarkerZoomVisible);
    const pauseFollowing = () => { followCamera.current = false; locateAttempt.current++; };
    const pauseManualRotation = (event: { originalEvent?: unknown }) => { if (event.originalEvent) pauseFollowing(); };
    map.on('dragstart', pauseFollowing);
    map.on('rotatestart', pauseManualRotation);
    const loadingTimer = setTimeout(() => {
      if (active && !contextMissing.current && !map.loaded()) setMapError('El mapa tarda en cargar. Comprueba tu conexión.');
    }, 15000);
    map.on('error', event => {
      if (!active) return;
      if (contextMissing.current) return;
      if ('sourceId' in event && event.sourceId === TRAFFIC_SOURCE_ID) {
        setTrafficTileError('No se pudo actualizar una parte del tráfico. Reintentaremos automáticamente.');
        if (Date.now() - lastTrafficDiagnostic.current >= 10000) {
          lastTrafficDiagnostic.current = Date.now(); setTrafficReload(value => value + 1);
        }
      } else setMapError('No se pudo cargar parte del mapa. Se conserva la información disponible.');
    });
    map.on('sourcedata', event => {
      if (active && event.sourceId === TRAFFIC_SOURCE_ID && event.sourceDataType === 'content' && event.tile && event.isSourceLoaded) {
        setTrafficLoadedAt(Date.now()); setTrafficTileError('');
      }
    });
    map.on('idle', () => { if (active && map.loaded() && map.areTilesLoaded()) setMapError(''); });
    const publishBounds = () => {
      const bounds = map.getBounds();
      if (!active || !bounds || editor) return;
      const viewport: MapBounds = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
      setMarkerBounds((previous) => previous && previous.every((value, index) => value === viewport[index]) ? previous : viewport);
      const west = Math.max(-180, bounds.getWest()), east = Math.min(180, bounds.getEast());
      const south = Math.max(-90, bounds.getSouth()), north = Math.min(90, bounds.getNorth());
      if (west < east && south < north) boundsCallback.current?.([west, south, east, north]);
    };
    map.on('moveend', publishBounds);
    const unsubscribe = onNetworkChange((status) => {
      if (!active || !status.connected) return;
      // A network reconnect while a style is still loading is not a reason to
      // destroy a healthy WebGL context (or reset an active camera).
      map.triggerRepaint();
    });
    const publishSize = () => {
      const element = containerRef.current;
      if (!active || !element || element.clientWidth <= 0) return;
      element.parentElement?.style.setProperty('--map-view-height', `${element.clientHeight}px`);
      map.resize();
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publishSize);
    resizeObserver?.observe(containerRef.current);
    publishSize();

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', () => {
      if (!active) return;
      clearTimeout(loadingTimer);
      setMapError('');
      setMapLoaded(true);
      publishBounds();

      // Add Road Risk Source and Layer
      map.addSource('civigo-roads', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      map.addLayer({
        id: 'civigo-roads-layer',
        type: 'line',
        source: 'civigo-roads',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': [
            'case',
            ['all', ['==', ['get', 'pendiente'], true], ['==', ['get', 'puntos'], 0]],
            '#64748b',
            [
              'match',
              ['get', 'nivelRiesgo'],
              0, RISK_COLORS[0],
              1, RISK_COLORS[1],
              2, RISK_COLORS[2],
              3, RISK_COLORS[3],
              4, RISK_COLORS[4],
              5, RISK_COLORS[5],
              '#94a3b8'
            ]
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 13, 1.8, 16, 2.8, 19, 4.2],
          'line-opacity': 0.75,
        },
      });

      // Add Incident Heatmap Density Layer
      map.addSource('civigo-incidents', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      map.addLayer({
        id: 'civigo-incident-areas',
        type: 'heatmap',
        source: 'civigo-incidents',
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            0, 0.35, 9, 0.9, 12, 1.15, 14, 1.5, 16, 1.7, 18, 1.8, 22, 2
          ],
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            0, 1, 8, 3, 10, 6, 12, 16, 13, 28, 14, 44, 16, 56, 18, 64, 22, 72
          ],
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            9, 0.9, 12, 0.85, 14, 0.65, 16, 0.45, 18, 0.34, 22, 0.25
          ],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(250,204,21,0)',
            0.08, 'rgba(250,204,21,0.65)',
            0.2, '#facc15',
            0.4, '#f97316',
            0.65, '#ef4444',
            1, '#dc2626'
          ],
        },
      });

      // Add Route Source and Layers
      map.addSource('route-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      // Route Casing
      map.addSource('route-completed-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'route-completed-line', type: 'line', source: 'route-completed-source',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#899aa9', 'line-width': 4, 'line-opacity': .45 } });
      map.addLayer({
        id: 'route-casing',
        type: 'line',
        source: 'route-source',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#ffffff',
          'line-width': 8,
          'line-opacity': 0.85,
        },
      });

      // Route Line
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route-source',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#1554d8',
          'line-width': 5,
        },
      });
      mapTheme.current?.apply(map, themeRef.current);
    });

    // Handle click on editor mode
    if (editor) {
      map.on('click', (e) => {
        void triggerHaptic('light');
        coordinatesCallback.current?.({ latitud: e.lngLat.lat, longitud: e.lngLat.lng });
      });
    }

    mapRef.current = map;

    return () => {
      active = false;
      try { const center = map.getCenter(); savedCamera.current = { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }; } catch { /* A destroyed native renderer has no readable camera. */ }
      recovery.dispose();
      if (recoveryRef.current === recovery) recoveryRef.current = null;
      locateAttempt.current += 1;
      clearTimeout(loadingTimer);
      unsubscribe();
      resizeObserver?.disconnect();
      stopMarkerZoom();
      map.off('dragstart', pauseFollowing);
      map.off('rotatestart', pauseManualRotation);
      map.off('webglcontextlost', contextLost);
      map.off('webglcontextrestored', contextRestored);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      externalMarkers.current.forEach(marker => marker.remove());
      externalMarkers.current.clear();
      userMarkerRef.current?.remove();
      editorMarkerRef.current?.remove();
      focusedMarkerRef.current?.remove(); focusedMarkerRef.current = null;
      userMarkerRef.current = null;
      editorMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [editor, reload]);

  useEffect(() => {
    recoveryRef.current?.setForeground(appActive);
    const map = mapRef.current;
    if (!map) return;
    if (appActive) { map.resize(); map.triggerRepaint(); }
    else map.stop();
  }, [appActive]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && mapLoaded) mapTheme.current?.apply(map, isDark);
  }, [isDark, mapLoaded]);

  useEffect(() => {
    if (focusRequestRef.current !== focusedLocation) {
      focusRequestRef.current = focusedLocation; pendingFocus.current = isPosition(focusedLocation);
    }
    const map = mapRef.current;
    if (!map || !mapLoaded || editor) return;
    if (!isPosition(focusedLocation)) { focusedMarkerRef.current?.remove(); focusedMarkerRef.current = null; return; }
    if (!focusedMarkerRef.current) {
      const element = document.createElement('span'); element.className = 'map-focused-location';
      element.setAttribute('role', 'img'); element.setAttribute('aria-label', 'Lugar seleccionado');
      focusedMarkerRef.current = new mapboxgl.Marker({ element }).setLngLat([focusedLocation.longitud, focusedLocation.latitud]).addTo(map);
    } else focusedMarkerRef.current.setLngLat([focusedLocation.longitud, focusedLocation.latitud]);
    if (appActive && pendingFocus.current) {
      pendingFocus.current = false; followCamera.current = false; locateAttempt.current++;
      map.flyTo({ center: [focusedLocation.longitud, focusedLocation.latitud], zoom: Math.max(15, map.getZoom()), bearing: 0, pitch: 0, duration: 650 });
    }
  }, [focusedLocation, mapLoaded, editor, appActive]);

  // Sync Route Geometry
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const source = map.getSource('route-source') as mapboxgl.GeoJSONSource | undefined;
    const completedSource = map.getSource('route-completed-source') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

    if (ruta && ruta.geometria) {
      const lines = following && routeProgress ? getNavigationRouteLines(ruta, routeProgress) : { pending: ruta.geometria, completed: null };
      source.setData(lines.pending ? {
        type: 'Feature',
        properties: {},
        geometry: lines.pending,
      } : empty);
      completedSource?.setData(lines.completed ? { type: 'Feature', properties: {}, geometry: lines.completed } : empty);

      // Fit bounds to route
      const coords = ruta.geometria.coordinates;
      if (coords && coords.length > 0 && !following) {
        const bounds = new mapboxgl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]);
        coords.forEach((c) => bounds.extend(c as [number, number]));
        map.fitBounds(bounds, { padding: 40, duration: 800 });
      }
    } else {
      source.setData(empty); completedSource?.setData(empty);
    }
  }, [ruta, mapLoaded, following, routeProgress]);

  // Sync User Position Marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (followRequest.current.following !== following || followRequest.current.recenterNonce !== recenterNonce) {
      followCamera.current = following;
      followRequest.current = { following, recenterNonce };
    }
    if (!isPosition(posicion)) {
      userMarkerRef.current?.remove(); userMarkerRef.current = null; return;
    }

    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'user-gps-marker';
      userMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([posicion.longitud, posicion.latitud])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([posicion.longitud, posicion.latitud]);
    }
    updateNavigationAvatarMarker(userMarkerRef.current.getElement(), navigationAvatar, following && !editor, posicion.heading, map.getBearing());
    if (!editor && following && appActive && followCamera.current && isUsableFix(posicion)) {
      map.easeTo({ center: [posicion.longitud, posicion.latitud], zoom: Math.max(16, map.getZoom()),
        bearing: Number.isFinite(posicion.heading) ? posicion.heading : 0, pitch: 35, duration: 650 });
    }
  }, [posicion, mapLoaded, editor, following, recenterNonce, navigationAvatar, appActive]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || editor) return;
    const updateHeading = () => {
      const state = cameraState.current, element = userMarkerRef.current?.getElement();
      if (element) updateNavigationAvatarMarker(element, state.navigationAvatar, state.following, state.posicion?.heading, map.getBearing());
    };
    map.on('rotate', updateHeading);
    return () => { map.off('rotate', updateHeading); };
  }, [mapLoaded, editor]);

  // Sync Editor Marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !editor || !isPosition(posicion)) return;

    if (!editorMarkerRef.current) {
      const el = document.createElement('div');
      const pinBody = document.createElement('div');
      pinBody.style.cssText =
        'width: 32px; height: 32px; background: #dc2626; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 3px 8px rgba(0,0,0,0.3);';
      const pinDot = document.createElement('div');
      pinDot.style.cssText = 'width: 10px; height: 10px; border-radius: 50%; background: #fff; transform: rotate(45deg);';
      pinBody.appendChild(pinDot);
      el.appendChild(pinBody);
      editorMarkerRef.current = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat([posicion.longitud, posicion.latitud])
        .addTo(map);

      editorMarkerRef.current.on('dragend', () => {
        const lngLat = editorMarkerRef.current?.getLngLat();
        if (lngLat) {
          coordinatesCallback.current?.({ latitud: lngLat.lat, longitud: lngLat.lng });
        }
      });
    } else {
      editorMarkerRef.current.setLngLat([posicion.longitud, posicion.latitud]);
    }
  }, [editor, posicion, mapLoaded]);

  // Sync Incident Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || editor) return;

    const currentMarkers = markersRef.current;
    if (!showEvents || !markerZoomVisible) {
      currentMarkers.forEach(marker => marker.remove()); currentMarkers.clear(); return;
    }
    const seenIds = new Set<number>();

    filteredIncidents.forEach((inc) => {
      if (!markerBounds || !isInMarkerViewport(inc, markerBounds)) return;
      seenIds.add(inc.id);

      if (currentMarkers.has(inc.id)) {
        updateIncidentMarker(currentMarkers.get(inc.id)!, inc, onSelectIncident);
        return;
      }

      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'incident-marker';
      const halo = document.createElement('span');
      halo.className = 'marker-risk-halo';
      halo.setAttribute('aria-hidden', 'true');
      const img = document.createElement('img');
      el.appendChild(halo);
      el.appendChild(img);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([inc.longitud, inc.latitud])
        .addTo(map);

      currentMarkers.set(inc.id, marker);
      updateIncidentMarker(marker, inc, onSelectIncident);
    });

    // Remove obsolete markers
    currentMarkers.forEach((marker, id) => {
      if (!seenIds.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
      }
    });
  }, [filteredIncidents, markerBounds, mapLoaded, editor, onSelectIncident, showEvents, markerZoomVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || editor) return;
    map.getContainer().classList.toggle('incident-events-visible', showEvents);
    if (!showEvents) setExternalSelected(null);
  }, [showEvents, mapLoaded, editor]);

  // Sync Road Features and Visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || editor) return;
    const source = map.getSource('civigo-roads') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(roadFeatures);
    }
    if (map.getLayer('civigo-roads-layer')) {
      map.setLayoutProperty('civigo-roads-layer', 'visibility', showRisks ? 'visible' : 'none');
    }
  }, [roadFeatures, showRisks, mapLoaded, editor]);

  // Sync Incident Heatmap Density
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || editor) return;
    const source = map.getSource('civigo-incidents') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      const points: GeoJSON.FeatureCollection<GeoJSON.Point> = {
        type: 'FeatureCollection',
        features: filteredIncidents
          .filter(isPosition)
          .map((inc) => ({
            type: 'Feature',
            id: inc.id,
            properties: {},
            geometry: { type: 'Point', coordinates: [inc.longitud, inc.latitud] },
          })),
      };
      source.setData(points);
    }
    if (map.getLayer('civigo-incident-areas')) {
      map.setLayoutProperty('civigo-incident-areas', 'visibility', showEvents && showZones ? 'visible' : 'none');
    }
  }, [filteredIncidents, showEvents, showZones, mapLoaded, editor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || editor) return;
    if (showTraffic && trafficReady) setTrafficLoadedAt(null);
    syncTrafficLayer(map, showTraffic && trafficReady, tileUrl, trafficStatus?.cobertura);
  }, [mapLoaded, editor, showTraffic, trafficReady, tileUrl, trafficStatus?.cobertura]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || editor) return;
    const markers = externalMarkers.current;
    const seen = new Set<string>();
    if (showTraffic && showEvents && markerZoomVisible) for (const incident of trafficData?.incidentes ?? []) {
      if (!markerBounds || !isInMarkerViewport(incident, markerBounds)) continue;
      if (typeFilter && incidentTypeKey({ tipo: incident.tipo }) !== typeFilter) continue;
      seen.add(incident.id);
      let marker = markers.get(incident.id);
      if (!marker) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'incident-marker external-traffic-marker';
        const image = document.createElement('img'); image.alt = '';
        button.appendChild(image);
        marker = new mapboxgl.Marker({ element: button }).setLngLat([incident.longitud, incident.latitud]).addTo(map);
        markers.set(incident.id, marker);
      }
      marker.setLngLat([incident.longitud, incident.latitud]);
      const element = marker.getElement();
      element.title = `${incident.titulo} · TomTom`;
      element.setAttribute('aria-label', element.title);
      const image = element.querySelector('img')!;
      image.src = getIncidentIconPath(incident.tipo, incident.titulo);
      image.onerror = () => { image.onerror = null; image.src = '/iconos/alerta.svg'; };
      element.onclick = event => { event.stopPropagation(); setExternalSelected(incident); };
    }
    markers.forEach((marker, id) => { if (!seen.has(id)) { marker.remove(); markers.delete(id); } });
  }, [mapLoaded, editor, trafficData, showTraffic, showEvents, markerZoomVisible, markerBounds, typeFilter]);

  const handleCenterUser = async () => {
    pendingFocus.current = false;
    void triggerHaptic('medium');
    const map = mapRef.current;
    const attempt = ++locateAttempt.current;
    let fix: LocationFix | null | undefined;
    try { fix = onLocateMe ? await onLocateMe() : posicion; }
    catch { return; }
    if (map && mapRef.current === map && appActiveRef.current && attempt === locateAttempt.current && isUsableFix(fix)) {
      followCamera.current = cameraState.current.following;
      map.flyTo({
        center: [fix.longitud, fix.latitud],
        zoom: 16,
        duration: 800,
        bearing: cameraState.current.following && Number.isFinite(fix.heading) ? fix.heading : 0,
        pitch: cameraState.current.following ? 35 : 0,
      });
    }
  };

  const handleResetOrientation = () => {
    void triggerHaptic('light');
    if (mapRef.current) {
      followCamera.current = false;
      mapRef.current.resetNorthPitch({ duration: 500 });
    }
  };

  const outsideTrafficCoverage = markerBounds && trafficStatus?.cobertura && (
    markerBounds[2] < trafficStatus.cobertura[0] || markerBounds[0] > trafficStatus.cobertura[2] ||
    markerBounds[3] < trafficStatus.cobertura[1] || markerBounds[1] > trafficStatus.cobertura[3]
  );
  const flowMessage = trafficLoading && !trafficStatus ? 'Consultando disponibilidad…' :
    trafficError || trafficFlowMessage(trafficStatus) || (!tileUrl ? 'El tráfico necesita el servicio HTTPS de CiviGo.' : '') ||
    trafficTileError || (outsideTrafficCoverage ? 'Fuera de la cobertura disponible.' : !trafficLoadedAt ? 'Cargando capa de tráfico…' :
      `Última recepción: ${new Date(trafficLoadedAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`);
  const riskMessage = !showRisks ? 'Capa vial desactivada.' : roadError ?
    roadFeatures.features.length ? 'Última capa disponible; actualización pendiente.' : 'Riesgo vial no disponible.' :
    loadingRoads && !roadFeatures.features.length ? 'Cargando riesgo vial…' : 'Gris: evaluación pendiente.';
  const legend = showTraffic ? <TrafficLegend status={flowMessage} available={trafficReady && !trafficError && !trafficTileError && !outsideTrafficCoverage && Boolean(trafficLoadedAt)} /> :
    <RiskLegend status={riskMessage} />;
  const compactLegend = showTraffic ? <TrafficLegend compact status={flowMessage} available={trafficReady && !trafficError && !trafficTileError && !outsideTrafficCoverage && Boolean(trafficLoadedAt)} /> :
    <RiskLegend compact />;
  const layerControls = <div className="map-layer-content">
    <div className="map-type-filter">
      <label htmlFor={themePreferenceId}>Aspecto del mapa</label>
      <select id={themePreferenceId} value={preference} onChange={event => setThemePreference(event.target.value as 'light' | 'dark' | 'system')}>
        <option value="system">Automático según el sistema</option><option value="light">Claro</option><option value="dark">Oscuro</option>
      </select>
    </div>
    <div className="map-layer-options">
      <label><input type="checkbox" checked={showRisks} onChange={event => { setShowRisks(event.target.checked); if (event.target.checked) setShowTraffic(false); }} />Riesgo por tramo</label>
      <label><input type="checkbox" checked={showTraffic} disabled={!trafficReady && !showTraffic} onChange={event => { setShowTraffic(event.target.checked); if (event.target.checked) setShowRisks(false); }} />Tráfico · TomTom</label>
      {!trafficReady && <small role="status">{flowMessage}</small>}
      <label><input type="checkbox" checked={showEvents} onChange={event => setShowEvents(event.target.checked)} />Incidentes</label>
      <label><input type="checkbox" checked={showZones} disabled={!showEvents} onChange={event => setShowZones(event.target.checked)} />Zonas de incidentes</label>
    </div>
    <div className="map-type-filter">
      <label htmlFor={typeFilterId}>Filtrar por tipo</label>
      <select id={typeFilterId} value={typeFilter} onChange={event => { setTypeFilter(event.target.value); setShowEvents(true); setExternalSelected(null); }}>
        <option value="">Todos los tipos</option>
        {typeOptions.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
      </select>
    </div>
    <small>El filtro cambia los iconos y sus zonas. El riesgo vial considera todos los incidentes.</small>
    {legend}
    {trafficData && !trafficData.trafico.disponible && <small role="status">{trafficData.trafico.motivo}</small>}
  </div>;

  return (
    <div className={`map-view-container map-glass-view ${editor ? 'map-editor-view' : ''} ${navigationMode ? 'map-navigation-mode' : ''} ${navigationExpanded ? 'map-navigation-expanded' : ''}`}>
      <div ref={containerRef} className="map-mapbox-root" />
      <div className="map-render-status" aria-live="polite">
        {statusNotices}
        {!mapLoaded && !mapError && <span className="map-loading-chip" role="status">{recoveringContext ? 'Recuperando mapa…' : 'Cargando mapa…'}</span>}
        {!editor && !navigationMode && loadingRoads && !roadFeatures.features.length && <span className="map-loading-chip" role="status">Cargando riesgo de las calles…</span>}
        {mapError && <MapStatusNotice title="Mapa no disponible" retryLabel="Reintentar mapa" onRetry={() => { automaticMapRebuilds.current = 0; setReload((value) => value + 1); }}><p>{mapError}</p></MapStatusNotice>}
        {roadError && (!navigationMode || navigationExpanded) && <MapStatusNotice title="Riesgo no disponible" retryLabel="Reintentar calles" retryDisabled={loadingRoads} onRetry={() => setRoadReload((value) => value + 1)}><p>Calles: {roadError} {roadFeatures.features.length ? 'Se conserva la última capa de riesgo.' : 'Riesgo vial aún no disponible.'}</p></MapStatusNotice>}
      </div>

      {!editor && <>
        {!navigationMode && <>
          <details className="map-layer-panel" open={effectiveLayersOpen} onToggle={event => { if (event.currentTarget.open !== effectiveLayersOpen) changeLayersOpen(event.currentTarget.open); }}>
            <summary onClick={event => { event.preventDefault(); changeLayersOpen(!effectiveLayersOpen); }}><Layers size={15} aria-hidden="true" /><span>Capas y filtros{typeFilter ? ' · 1 filtro' : ''}</span><ChevronDown size={15} aria-hidden="true" /></summary>
            {layerControls}
          </details>
          <div className="map-fixed-legend">{compactLegend}</div>
        </>}
        {navigationMode && effectiveLayersOpen && <div className="map-layers-drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) changeLayersOpen(false); }}>
          <div className="map-layers-drawer" role="dialog" aria-modal="true" aria-labelledby={layersTitleId} tabIndex={-1} ref={layersDialogRef}>
            <div className="map-layers-drawer-heading"><h2 id={layersTitleId}>Capas del mapa</h2><button type="button" aria-label="Cerrar capas del mapa" onClick={() => changeLayersOpen(false)}><X size={20} /></button></div>
            {layerControls}
          </div>
        </div>}
        {externalSelected && showTraffic && showEvents && <section className="map-external-detail" aria-label="Aviso temporal de tráfico">
          <button type="button" aria-label="Cerrar aviso de tráfico" onClick={() => setExternalSelected(null)}><X size={18} /></button>
          <strong>{externalSelected.titulo}</strong><p>{externalSelected.descripcion}</p>
          <small>© TomTom · Aviso temporal. No suma riesgo histórico de CiviGo.</small>
        </section>}
      </>}

      {/* Floating Controls for Mobile */}
      <div className="map-floating-controls">
        <button
          type="button"
          className="map-action-fab"
          onClick={handleCenterUser}
          disabled={locating}
          aria-label={navigationMode ? 'Centrar ubicación y seguir recorrido' : 'Ubicar mi posición'}
        >
          <Locate size={18} aria-hidden="true" />
        </button>

        {!navigationMode && <button
          type="button"
          className="map-action-fab"
          onClick={handleResetOrientation}
          aria-label="Restablecer orientación al norte"
        >
          <Compass size={18} aria-hidden="true" />
        </button>}
      </div>
    </div>
  );
};
