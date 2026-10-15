import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Locate, Compass, Layers } from 'lucide-react';
import { triggerHaptic } from '../../services/native';
import { getIncidentIconPath } from '../../services/incidentIcons';
import { RISK_COLORS } from '../../types';
import type { Incidente, Ruta, Posicion, LocationFix } from '../../types';
import { RiskLegend } from './RiskLegend';
import { NavigationService } from '../../services/navigation';
import { applyRoadRisk, type RoadGeometry, type RoadRisk } from '../../services/roadMap';

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
  onLocateMe?: () => void;
  locating?: boolean;
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<number, mapboxgl.Marker>>(new Map());
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const editorMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [showRisks, setShowRisks] = useState(true);
  const [roadFeatures, setRoadFeatures] = useState<GeoJSON.FeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  });
  const roadCache = useRef<RoadGeometry | null>(null);
  const roadRevision = useRef<string>('');

  // Fetch live road risk data for Ica
  useEffect(() => {
    if (editor) return;
    let active = true;

    const loadRoads = async () => {
      try {
        const riskData = await NavigationService.getRoadRisks();
        let geometry = roadCache.current;
        if (!geometry || geometry.version !== riskData.version) {
          geometry = await NavigationService.getRoadGeometry(riskData.version);
          roadCache.current = geometry;
          roadRevision.current = '';
        }
        if (active && geometry && roadRevision.current !== riskData.revision) {
          roadRevision.current = riskData.revision;
          const styled = applyRoadRisk(geometry, riskData);
          setRoadFeatures(styled);
        }
      } catch {
        // Fallback or offline: preserve cached features
      }
    };

    void loadRoads();
    const interval = setInterval(loadRoads, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [editor]);

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;

    const initialCenter: [number, number] = posicion
      ? [posicion.longitud, posicion.latitud]
      : [-75.7286, -14.0678]; // Ica, Perú

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: initialCenter,
      zoom: editor ? 16 : 13.5,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', () => {
      setMapLoaded(true);

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
        onSelectCoordinates?.({ latitud: e.lngLat.lat, longitud: e.lngLat.lng });
      });
    }

    mapRef.current = map;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      userMarkerRef.current?.remove();
      editorMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [editor]);

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
    if (!map || !posicion) return;

    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'user-gps-marker';
      el.innerHTML = `
        <div style="width: 22px; height: 22px; border-radius: 50%; background: #1554d8; border: 3px solid #fff; box-shadow: 0 0 10px rgba(21, 84, 216, 0.7); display: flex; align-items: center; justify-content: center;">
          <div style="width: 6px; height: 6px; border-radius: 50%; background: #fff;"></div>
        </div>
      `;
      userMarkerRef.current = new mapboxgl.Marker({ element: el })
        .setLngLat([posicion.longitud, posicion.latitud])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([posicion.longitud, posicion.latitud]);
    }
  }, [posicion]);

  // Sync Editor Marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !editor || !posicion) return;

    if (!editorMarkerRef.current) {
      const el = document.createElement('div');
      el.innerHTML = `
        <div style="width: 32px; height: 32px; background: #dc2626; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 3px 8px rgba(0,0,0,0.3);">
          <div style="width: 10px; height: 10px; border-radius: 50%; background: #fff; transform: rotate(45deg);"></div>
        </div>
      `;
      editorMarkerRef.current = new mapboxgl.Marker({ element: el, draggable: true })
        .setLngLat([posicion.longitud, posicion.latitud])
        .addTo(map);

      editorMarkerRef.current.on('dragend', () => {
        const lngLat = editorMarkerRef.current?.getLngLat();
        if (lngLat) {
          onSelectCoordinates?.({ latitud: lngLat.lat, longitud: lngLat.lng });
        }
      });
    } else {
      editorMarkerRef.current.setLngLat([posicion.longitud, posicion.latitud]);
    }
  }, [editor, posicion]);

  // Sync Incident Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || editor) return;

    const currentMarkers = markersRef.current;
    const seenIds = new Set<number>();

    incidentes.forEach((inc) => {
      if (!Number.isFinite(inc.longitud) || !Number.isFinite(inc.latitud)) return;
      seenIds.add(inc.id);

      if (currentMarkers.has(inc.id)) {
        return; // already rendered
      }

      const riskLevel = inc.gravedad ?? inc.nivelRiesgo ?? 0;
      const riskColor = RISK_COLORS[Math.min(Math.max(riskLevel, 0), RISK_COLORS.length - 1)];
      const iconPath = getIncidentIconPath(inc.tipoSlug, inc.tipoNombre, inc.tipo);

      const el = document.createElement('div');
      el.className = 'incident-marker';
      el.innerHTML = `
        <div class="marker-inner">
          <img src="${iconPath}" alt="${inc.tipoNombre || inc.tipo}" onerror="this.src='/iconos/robo.png'"/>
          <span class="marker-risk-pill" style="background-color: ${riskColor};"></span>
        </div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        void triggerHaptic('light');
        onSelectIncident?.(inc);
      });

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([inc.longitud, inc.latitud])
        .addTo(map);

      currentMarkers.set(inc.id, marker);
    });

    // Remove obsolete markers
    currentMarkers.forEach((marker, id) => {
      if (!seenIds.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
      }
    });
  }, [incidentes, mapLoaded, editor, onSelectIncident]);

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
          .filter((inc) => Number.isFinite(inc.longitud) && Number.isFinite(inc.latitud))
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

  const handleCenterUser = () => {
    void triggerHaptic('medium');
    if (posicion && mapRef.current) {
      mapRef.current.flyTo({
        center: [posicion.longitud, posicion.latitud],
        zoom: 16,
        duration: 800,
      });
    }
    onLocateMe?.();
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
