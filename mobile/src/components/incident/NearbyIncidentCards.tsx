import React from 'react';
import { CalendarDays, MapPin, RefreshCw } from 'lucide-react';
import { IncidentIcon } from '../map/IncidentIcon';
import { formatDate } from '../../services/api';
import { formatDistance, isUsableFix } from '../../services/navigation';
import { incidentDate, incidentRisk, incidentState, visibleNearbyIncidents } from '../../services/nearbyIncidentPresentation';
import { distance } from '../../services/api';
import { RISK_COLORS, RISK_NAMES, type Incidente, type LocationFix } from '../../types';
import './nearby-incident-cards.css';

export interface NearbyIncidentCardsProps {
  incidents: readonly Incidente[];
  loading?: boolean;
  error?: string;
  updatedAt?: Date | null;
  position?: LocationFix | null;
  onSelect: (incident: Incidente) => void;
  onRefresh?: () => void;
}

export const NearbyIncidentCards: React.FC<NearbyIncidentCardsProps> = ({ incidents, loading = false, error = '', updatedAt, position, onSelect, onRefresh }) => {
  const hasFix = isUsableFix(position);
  const items = visibleNearbyIncidents(incidents, hasFix ? position : null);
  return <details className="nearby-incident-cards">
    <summary>Recientes cerca de ti <span>Hasta 10 · 1 km</span></summary>
    <div className="nearby-card-toolbar"><small>{updatedAt && Number.isFinite(updatedAt.getTime()) ? `Consulta: ${updatedAt.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' })}` : 'Incidentes públicos disponibles'}</small>{onRefresh && <button type="button" aria-label="Actualizar incidentes cercanos" disabled={loading || !hasFix} onClick={onRefresh}><RefreshCw size={15} aria-hidden="true" /></button>}</div>
    {!hasFix && <p className="nearby-card-notice">Activa una ubicación GPS reciente para actualizar los incidentes cercanos.{updatedAt ? ' Se muestra la última consulta.' : ''}</p>}
    {loading && <p className="nearby-card-notice" role="status">{updatedAt ? 'Actualizando…' : 'Buscando incidentes cercanos…'}</p>}
    {error && <p className="nearby-card-notice" role="alert">{error}{updatedAt ? ' Se conserva la última consulta.' : ''}</p>}
    {updatedAt && !loading && items.length === 0 && <p className="nearby-card-notice">No hay incidentes recientes publicados dentro de 1 km.</p>}
    <div className="nearby-card-list">{items.map(incident => {
      const risk = incidentRisk(incident), date = incidentDate(incident), state = incidentState(incident);
      const meters = hasFix && position ? distance(position, incident) : null;
      return <article key={incident.id} className="nearby-mini-card">
        <div className="nearby-mini-heading"><IncidentIcon tipo={incident.tipoNombre || incident.tipo} slug={incident.tipoSlug} size={30} /><div><h3>{incident.tipoNombre || incident.tipo || 'Incidente'}</h3>{state && <small className="nearby-mini-state">{state}</small>}</div><span className="nearby-mini-risk" style={risk !== null ? { borderColor: RISK_COLORS[risk] } : undefined}>{risk === null ? 'Riesgo por evaluar' : `Nivel ${risk} · ${RISK_NAMES[risk]}`}</span></div>
        {incident.descripcion && <p className="nearby-mini-description">{incident.descripcion}</p>}
        <div className="nearby-mini-meta"><span><MapPin size={12} aria-hidden="true" />{incident.distrito || `${incident.latitud.toFixed(4)}, ${incident.longitud.toFixed(4)}`}{meters !== null && Number.isFinite(meters) ? ` · ${formatDistance(meters)}` : ''}</span>{date && <span><CalendarDays size={12} aria-hidden="true" />{formatDate(date)}</span>}</div>
        <button type="button" className="nearby-mini-view" onClick={() => onSelect(incident)} aria-label={`Ver en mapa ${incident.tipoNombre || incident.tipo} #${incident.id}`}><MapPin size={13} aria-hidden="true" />Ver en mapa</button>
      </article>;
    })}</div>
  </details>;
};
