import { RISK_COLORS, RISK_NAMES } from '@/lib/types';

export default function RiskLegend() {
    return <div className="risk-legend" aria-label="Riesgo registrado por zona">
        <strong>Riesgo registrado por zona</strong>
        <div className="risk-scale" role="img" aria-label="Niveles del riesgo: de 0 seguro a 5 crítico">
            {RISK_COLORS.map((color, level) => <span key={color} title={`${level} · ${RISK_NAMES[level]}`} style={{ background: color }}/>) }
        </div>
    </div>;
}
