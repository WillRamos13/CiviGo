import React from 'react';
import { getIncidentIconPath, getIncidentScale } from '../../services/incidentIcons';

interface IncidentIconProps {
  tipo?: string;
  slug?: string;
  size?: number;
  className?: string;
}

export const IncidentIcon: React.FC<IncidentIconProps> = ({
  tipo,
  slug,
  size = 32,
  className = '',
}) => {
  const iconPath = getIncidentIconPath(slug, tipo);
  const scale = getIncidentScale(slug);

  return (
    <div
      className={`incident-icon-wrapper ${className}`}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <img
        src={iconPath}
        alt={tipo || slug || 'Incidente'}
        style={{
          width: `${size * scale}px`,
          height: `${size * scale}px`,
          objectFit: 'contain',
        }}
        onError={(e) => {
          // If image fails, show default alert icon
          (e.target as HTMLImageElement).src = '/iconos/robo.png';
        }}
      />
    </div>
  );
};
