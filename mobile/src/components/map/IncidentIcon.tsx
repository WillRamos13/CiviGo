import React, { useState } from 'react';
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
  const [failure, setFailure] = useState({ path: '', stage: 0 });
  const stage = failure.path === iconPath ? failure.stage : 0;
  const source = stage === 1 ? '/iconos/alerta.svg' : iconPath;

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
      {stage >= 2 ? <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={tipo || slug || 'Incidente'}><path d="M12 3 2 21h20Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M12 9v5m0 3v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> : <img
        key={source}
        src={source}
        alt={tipo || slug || 'Incidente'}
        style={{
          width: `${size * scale}px`,
          height: `${size * scale}px`,
          objectFit: 'contain',
        }}
        onError={() => setFailure({ path: iconPath, stage: source === '/iconos/alerta.svg' ? 2 : 1 })}
      />}
    </div>
  );
};
