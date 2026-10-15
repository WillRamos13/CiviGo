import type mapboxgl from 'mapbox-gl';
import { triggerHaptic } from '../../services/native';
import { getIncidentIconPath } from '../../services/incidentIcons';
import { RISK_COLORS, type Incidente } from '../../types';

export function updateIncidentMarker(
  marker: Pick<mapboxgl.Marker, 'getElement' | 'setLngLat'>,
  incident: Incidente,
  onSelect?: (incident: Incidente) => void
) {
  marker.setLngLat([incident.longitud, incident.latitud]);
  const element = marker.getElement();
  const name = incident.tipoNombre || incident.tipo || 'Incidente';
  element.title = `${name}${incident.descripcion ? `: ${incident.descripcion}` : ''}`;
  element.setAttribute('aria-label', element.title);
  element.dataset.incidentId = String(incident.id);
  const image = element.querySelector('img');
  if (image) {
    image.onerror = () => { image.onerror = null; image.src = '/iconos/alerta.svg'; };
    image.src = getIncidentIconPath(incident.tipoSlug, incident.tipoNombre, incident.tipo);
    image.alt = name;
  }
  const risk = incident.gravedad ?? incident.nivelRiesgo;
  const pill = element.querySelector<HTMLElement>('.marker-risk-pill');
  if (pill) {
    pill.style.backgroundColor = risk !== null && risk !== undefined && Number.isFinite(risk)
      ? RISK_COLORS[Math.min(5, Math.max(0, Math.round(risk)))] : '#64748b';
    pill.textContent = '';
  }
  element.onclick = (event) => { event.stopPropagation(); void triggerHaptic('light'); onSelect?.(incident); };
}
