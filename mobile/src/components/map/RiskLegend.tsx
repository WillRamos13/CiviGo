import React, { useState } from 'react';
import { RISK_COLORS, RISK_NAMES } from '../../types';
import { Info, X } from 'lucide-react';

export const RiskLegend: React.FC = () => {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="map-action-fab"
        onClick={() => setOpen(!open)}
        aria-label="Leyenda de riesgo"
      >
        <Info size={19} />
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: 'absolute',
            bottom: 50,
            right: 0,
            width: 200,
            padding: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 35,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <strong style={{ fontSize: 12 }}>Niveles de riesgo vial</strong>
            <button
              type="button"
              className="icon-btn"
              style={{ width: 24, height: 24 }}
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {RISK_NAMES.map((name, idx) => (
              <div
                key={name}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    backgroundColor: RISK_COLORS[idx],
                    flexShrink: 0,
                  }}
                />
                <span>{name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
