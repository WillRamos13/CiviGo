import React, { useState, useEffect, useCallback } from 'react';
import { MapView } from '../components/map/MapView';
import { RoutePlanner } from '../components/navigation/RoutePlanner';
import { IncidentDetailModal } from '../components/incident/IncidentDetailModal';
import { ChatBotModal } from '../components/chat/ChatBotModal';
import { useGeolocation } from '../hooks/useGeolocation';
import { api, errorMessage } from '../services/api';
import { triggerHaptic } from '../services/native';
import { MessageCircle, ChevronUp, ChevronDown, ListFilter, ShieldAlert } from 'lucide-react';
import type { Incidente, Ruta } from '../types';

interface MapPageProps {
  onGoReport: () => void;
}

export const MapPage: React.FC<MapPageProps> = ({ onGoReport }) => {
  const { position, loading: gpsLoading, locate } = useGeolocation(true);
  const [incidents, setIncidents] = useState<Incidente[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<Incidente | null>(null);
  const [activeRoute, setActiveRoute] = useState<Ruta | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [loadingIncidents, setLoadingIncidents] = useState(false);
  const [error, setError] = useState('');

  // Fetch incidents in Ica
  const loadIncidents = useCallback(async () => {
    setLoadingIncidents(true);
    try {
      // Load map incidents
      const data = await api<Incidente[]>('/incidents');
      setIncidents(data || []);
      setError('');
    } catch (err) {
      // In case of network error, keep existing incidents
    } finally {
      setLoadingIncidents(false);
    }
  }, []);

  useEffect(() => {
    void loadIncidents();
    const interval = setInterval(loadIncidents, 30000); // 30s auto-refresh
    return () => clearInterval(interval);
  }, [loadIncidents]);

  const handleStartNav = (ruta: Ruta) => {
    void triggerHaptic('medium');
    setActiveRoute(ruta);
    setIsNavigating(true);
    setSheetOpen(false);
  };

  const handleStopNav = () => {
    void triggerHaptic('medium');
    setIsNavigating(false);
    setActiveRoute(null);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* Mapbox Map */}
      <MapView
        incidentes={incidents}
        ruta={activeRoute}
        posicion={position}
        onSelectIncident={(inc) => setSelectedIncident(inc)}
        onLocateMe={locate}
        locating={gpsLoading}
      />

      {/* Floating ChatBot Button */}
      <button
        type="button"
        className="chatbot-fab"
        onClick={() => {
          void triggerHaptic('light');
          setChatOpen(true);
        }}
        aria-label="Abrir asistente de ayuda CiviGo"
      >
        <MessageCircle size={24} />
      </button>

      {/* Expandable Route & Conditions Sheet */}
      <div
        className="map-bottom-sheet"
        style={{
          transform: sheetOpen ? 'translateY(0)' : 'translateY(calc(100% - 48px))',
          paddingBottom: 'calc(16px + var(--safe-bottom))',
        }}
      >
        <div
          className="bottom-sheet-handle"
          onClick={() => {
            void triggerHaptic('light');
            setSheetOpen(!sheetOpen);
          }}
          style={{ cursor: 'pointer', padding: '6px 0' }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: sheetOpen ? 12 : 0,
            cursor: 'pointer',
          }}
          onClick={() => {
            void triggerHaptic('light');
            setSheetOpen(!sheetOpen);
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="eyebrow" style={{ fontSize: 11 }}>
              {isNavigating ? 'NAVEGACIÓN' : 'RUTAS Y CONDICIONES'}
            </span>
            <span className="badge" style={{ fontSize: 10 }}>
              {incidents.length} alertas en Ica
            </span>
          </div>

          <button type="button" className="icon-btn" style={{ width: 28, height: 28 }}>
            {sheetOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        </div>

        {sheetOpen && (
          <RoutePlanner
            currentPosition={position ? { latitud: position.latitud, longitud: position.longitud } : null}
            onSelectRoute={(r) => setActiveRoute(r)}
            activeRoute={activeRoute}
            onStartNavigation={handleStartNav}
            onStopNavigation={handleStopNav}
            isNavigating={isNavigating}
          />
        )}
      </div>

      {/* Incident Detail Modal */}
      {selectedIncident && (
        <IncidentDetailModal
          incidente={selectedIncident}
          onClose={() => setSelectedIncident(null)}
          onRefresh={loadIncidents}
        />
      )}

      {/* AI Assistant Modal */}
      <ChatBotModal isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
};
