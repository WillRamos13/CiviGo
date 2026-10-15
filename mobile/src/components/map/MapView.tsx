import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Locate, Compass, Layers } from 'lucide-react';
import { triggerHaptic, onNetworkChange } from '../../services/native';
import { errorMessage } from '../../services/api';
import { updateIncidentMarker } from './incidentMarker';
import { RISK_COLORS } from '../../types';
import type { Incidente, Ruta, Posicion, LocationFix } from '../../types';
import { RiskLegend } from './RiskLegend';
import { NavigationService, isPosition, isUsableFix } from '../../services/navigation';
import { applyRoadRisk, type RoadGeometry } from '../../services/roadMap';
import { isInMarkerViewport, type MapBounds } from '../../services/mapData';

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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<number, mapboxgl.Marker>>(new Map());
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const editorMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [showRisks, setShowRisks] = useState(true);
  const [mapError, setMapError] = useState('');
  const [roadError, setRoadError] = useState('');
  const [loadingRoads, setLoadingRoads] = useState(false);
  const [reload, setReload] = useState(0);
  const [roadReload, setRoadReload] = useState(0);
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

  // Fetch live road risk data for Ica
  useEffect(() => {
    if (editor || !refreshEnabled) return;
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
  }, [editor, roadReload, refreshEnabled]);

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current) return;
    let active = true;
    setMapLoaded(false);
    setMapError('');
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const initialCenter: [number, number] = isPosition(posicion)
      ? [posicion.longitud, posicion.latitud]
      : [-75.7286, -14.0678]; // Ica, Perú

    let map: mapboxgl.Map;
    try { map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: initialCenter,
      zoom: editor ? 16 : 13.5,
      attributionControl: false,
    }); } catch {
      setMapError('No se pudo iniciar el mapa en este dispositivo.');
      return;
    }
    const loadingTimer = setTimeout(() => {
      if (active && !map.loaded()) setMapError('El mapa tarda en cargar. Comprueba tu conexión.');
    }, 15000);
    map.on('error', () => { if (active) setMapError('No se pudo cargar parte del mapa. Se conserva la información disponible.'); });
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
      if (!map.isStyleLoaded()) setReload((value) => value + 1);
      else map.triggerRepaint();
    });
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (active && containerRef.current && containerRef.current.clientWidth > 0) map.resize();
    });
    resizeObserver?.observe(containerRef.current);

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
      locateAttempt.current += 1;
      clearTimeout(loadingTimer);
      unsubscribe();
      resizeObserver?.disconnect();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      userMarkerRef.current?.remove();
      editorMarkerRef.current?.remove();
      userMarkerRef.current = null;
      editorMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [editor, reload]);

  // Sync Route Geometry
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    const source = map.getSource('route-source') as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    if (ruta && ruta.geometria) {
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: ruta.geometria,
      });

      // Fit bounds to route
      const coords = ruta.geometria.coordinates;
      if (coords && coords.length > 0) {
        const bounds = new mapboxgl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]);
        coords.forEach((c) => bounds.extend(c as [number, number]));
        map.fitBounds(bounds, { padding: 40, duration: 800 });
      }
    } else {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      });
    }
  }, [ruta, mapLoaded]);

  // Sync User Position Marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isPosition(posicion)) return;

    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'user-gps-marker';
      const outerRing = document.createElement('div');
      outerRing.style.cssText =
        'width: 22px; height: 22px; border-radius: 50%; background: #1554d8; border: 3px solid #fff; box-shadow: 0 0 10px rgba(21, 84, 216, 0.7); display: flex; align-items: center; justify-content: center;';
      const innerDot = document.createElement('div');
      innerDot.style.cssText = 'width: 6px; height: 6px; border-radius: 50%; background: #fff;';
      outerRing.appendChild(innerDot);
      el.appendChild(outerRing);
      userMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([posicion.longitud, posicion.latitud])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([posicion.longitud, posicion.latitud]);
    }
  }, [posicion, mapLoaded]);

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
    const seenIds = new Set<number>();

    incidentes.forEach((inc) => {
      if (!markerBounds || !isInMarkerViewport(inc, markerBounds)) return;
      seenIds.add(inc.id);

      if (currentMarkers.has(inc.id)) {
        updateIncidentMarker(currentMarkers.get(inc.id)!, inc, onSelectIncident);
        return;
      }

      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'incident-marker';
      const inner = document.createElement('div');
      inner.className = 'marker-inner';

      const img = document.createElement('img');

      const pill = document.createElement('span');
      pill.className = 'marker-risk-pill';

      inner.appendChild(img);
      inner.appendChild(pill);
      el.appendChild(inner);

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
  }, [incidentes, markerBounds, mapLoaded, editor, onSelectIncident]);

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
        features: incidentes
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
      map.setLayoutProperty('civigo-incident-areas', 'visibility', showRisks ? 'visible' : 'none');
    }
  }, [incidentes, showRisks, mapLoaded, editor]);

  const handleCenterUser = async () => {
    void triggerHaptic('medium');
    const map = mapRef.current;
    const attempt = ++locateAttempt.current;
    let fix: LocationFix | null | undefined;
    try { fix = onLocateMe ? await onLocateMe() : posicion; }
    catch { return; }
    if (map && mapRef.current === map && attempt === locateAttempt.current && isUsableFix(fix)) {
      map.flyTo({
        center: [fix.longitud, fix.latitud],
        zoom: 16,
        duration: 800,
      });
    }
  };

  const handleResetOrientation = () => {
    void triggerHaptic('light');
    if (mapRef.current) {
      mapRef.current.resetNorthPitch({ duration: 500 });
    }
  };

  return (
    <div className="map-view-container">
      <div ref={containerRef} className="map-mapbox-root" />
      <div className="map-render-status" aria-live="polite">
        {!mapLoaded && !mapError && <p role="status">Cargando mapa…</p>}
        {!editor && loadingRoads && !roadFeatures.features.length && <p role="status">Cargando riesgo de las calles…</p>}
        {mapError && <p role="alert">{mapError}<button type="button" className="btn btn-secondary btn-small" onClick={() => setReload((value) => value + 1)}>Reintentar mapa</button></p>}
        {roadError && <p role="alert">Calles: {roadError} {roadFeatures.features.length ? 'Se conserva la última capa de riesgo.' : 'Riesgo vial aún no disponible.'}<button type="button" className="btn btn-secondary btn-small" disabled={loadingRoads} onClick={() => setRoadReload((value) => value + 1)}>Reintentar calles</button></p>}
      </div>

      {/* Floating Controls for Mobile */}
      <div className="map-floating-controls">
        <button
          type="button"
          className="map-action-fab"
          onClick={handleCenterUser}
          disabled={locating}
          aria-label="Ubicar mi posición"
        >
          <Locate size={20} color="var(--brand)" />
        </button>

        <button
          type="button"
          className="map-action-fab"
          onClick={handleResetOrientation}
          aria-label="Restablecer orientación al norte"
        >
          <Compass size={20} />
        </button>

        <button
          type="button"
          className="map-action-fab"
          onClick={() => {
            void triggerHaptic('light');
            setShowRisks(!showRisks);
          }}
          aria-label="Alternar capas de riesgos e incidentes"
          title="Capa de riesgos e incidentes"
        >
          <Layers size={20} color={showRisks ? 'var(--brand)' : 'var(--muted)'} />
        </button>

        <RiskLegend />
      </div>
    </div>
  );
};
