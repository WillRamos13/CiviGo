import React from 'react';
import { IncidentIcon } from '../map/IncidentIcon';
import { formatDate } from '../../services/api';
import { RISK_COLORS, RISK_NAMES } from '../../types';
import type { Incidente } from '../../types';
import { MapPin, Users, Calendar } from 'lucide-react';

interface IncidentCardProps {
  incidente: Incidente;
  onClick?: () => void;
}

export const IncidentCard: React.FC<IncidentCardProps> = ({ incidente, onClick }) => {
  const riskLevel = incidente.gravedad ?? incidente.nivelRiesgo ?? 0;
  const riskIndex = Math.min(Math.max(riskLevel, 0), RISK_COLORS.length - 1);
  const riskColor = RISK_COLORS[riskIndex];
  const riskName = RISK_NAMES[riskIndex];

  return (
    <article
      className="card"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        padding: '14px',
        marginBottom: '10px',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <IncidentIcon
          tipo={incidente.tipoNombre || incidente.tipo}
          slug={incidente.tipoSlug}
          size={38}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {incidente.tipoNombre || incidente.tipo}
            </h3>
            <span
              className="badge"
              style={{
                backgroundColor: riskColor,
                color: '#fff',
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 4,
                flexShrink: 0,
              }}
            >
              {riskName}
            </span>
          </div>

          {incidente.descripcion && (
            <p
              className="muted"
              style={{
                fontSize: 12,
                margin: '4px 0 8px',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {incidente.descripcion}
            </p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--muted)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Calendar size={12} />
              {formatDate(incidente.fechaEvento || incidente.fechaCreacion || incidente.creadoEn)}
            </span>

            {incidente.totalReportes > 1 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Users size={12} />
                {incidente.totalReportes} reportes
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};
