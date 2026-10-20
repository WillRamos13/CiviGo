import React from 'react';
import { RISK_COLORS, RISK_NAMES } from '../../types';
import { ShieldCheck, TrafficCone } from 'lucide-react';

export const RiskLegend: React.FC<{ status?: string; compact?: boolean }> = ({ status, compact = false }) => (
  <section className={`map-mini-legend map-risk-legend ${compact ? 'map-legend-compact' : ''}`} aria-label="Riesgo registrado por zona">
    <strong><ShieldCheck size={13} aria-hidden="true" />Riesgo por zona</strong>
    <div className="map-legend-scale" role="img" aria-label="Riesgo registrado de 0 seguro a 5 crítico">
      {RISK_COLORS.map((color, level) => <span key={level} style={{ backgroundColor: color }} title={`${level} · ${RISK_NAMES[level]}`} />)}
    </div>
    {!compact && <><div className="map-legend-levels" aria-hidden="true">{RISK_COLORS.map((_, level) => <span key={level}>{level}</span>)}</div>
      <div className="map-legend-ends" aria-hidden="true"><span>Seguro</span><span>Crítico</span></div>
      {status && <small role="status">{status}</small>}</>}
  </section>
);

export const TrafficLegend: React.FC<{ status: string; available: boolean; compact?: boolean }> = ({ status, available, compact = false }) => (
  <section className={`map-mini-legend map-traffic-legend ${available ? '' : 'map-legend-unavailable'} ${compact ? 'map-legend-compact' : ''}`} aria-label="Leyenda de tráfico TomTom">
    <strong><TrafficCone size={13} aria-hidden="true" />Tráfico · © TomTom</strong>
    <div className="map-legend-scale" role="img" aria-label="Tráfico: verde fluido, amarillo lento y rojo congestionado">
      <span style={{ backgroundColor: '#22c55e' }} /><span style={{ backgroundColor: '#facc15' }} /><span style={{ backgroundColor: '#ef4444' }} />
    </div>
    {!compact && <><div className="map-legend-ends map-traffic-labels" aria-hidden="true"><span>Fluido</span><span>Lento</span><span>Congestionado</span></div>
      <small role="status">{status}</small></>}
  </section>
);
