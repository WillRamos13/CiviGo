'use client';
import { useState, useId } from 'react';
import { RISK_COLORS, RISK_NAMES } from '@/lib/types';
import CollapsiblePanel from './CollapsiblePanel';

export default function RiskLegend({ open, onOpenChange }: { open?: boolean; onOpenChange?: (open: boolean) => void }) {
    const [detail, setDetail] = useState(false), detailId = useId();
    return <CollapsiblePanel title="Leyenda del mapa" className="risk-legend" open={open} onOpenChange={onOpenChange}>
        <strong>Riesgo registrado por tramo</strong>
        <div className="risk-scale">{RISK_COLORS.map(c => <span key={c} style={{ background: c }}/>)}</div>
        <div className="legend-endpoints"><span>0 · Seguro</span><span>5 · Crítico</span></div>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 9, marginTop: 9, color: 'var(--muted)' }}>
            <span className="legend-dot" style={{ background: '#64748b' }}/>Gris: evaluación pendiente
        </div>
        <div className="incident-area-legend">
            <strong>Zonas de incidentes</strong>
            <div className="incident-area-scale" aria-hidden="true"/>
            <div className="legend-endpoints"><span>Centro</span><span>Borde</span></div>
        </div>
        <button aria-expanded={detail} aria-controls={detailId} className="btn btn-quiet btn-small" style={{ padding: '5px 0', fontSize: 9, minHeight: 20 }} onClick={() => setDetail(!detail)}>
            {detail ? 'Ocultar' : 'Ver'} niveles y puntos
        </button>
        <div id={detailId} hidden={!detail}>
            <div className="legend-details">{RISK_NAMES.map((name, i) => <div key={name}><span className="legend-dot" style={{ background: RISK_COLORS[i] }}/>{i} · {name}</div>)}</div>
            <p style={{ fontSize: 9, margin: '10px 0 0', maxWidth: 210 }}>0 puntos: nivel 0. Más de 0–5: nivel 1; &gt;5–10: 2; &gt;10–15: 3; &gt;15–20: 4; &gt;20: 5. Según los reportes disponibles.</p>
            <p style={{ fontSize: 9, margin: '7px 0 0', maxWidth: 210 }}>Al alejar el zoom las zonas de incidentes se unen visualmente. Consulta la gravedad en cada marcador.</p>
        </div>
    </CollapsiblePanel>;
}
