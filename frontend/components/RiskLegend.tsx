import { RISK_COLORS, RISK_NAMES } from '@/lib/types';
import { ShieldAlert, TrafficCone } from 'lucide-react';
import styles from './RiskLegend.module.css';

export default function RiskLegend() {
    return <div className={`risk-legend ${styles.legend}`} aria-label="Riesgo registrado por zona">
        <strong className={styles.title}><ShieldAlert size={14} aria-hidden="true"/>Riesgo por zona</strong>
        <div className={`risk-scale ${styles.scale}`} role="img" aria-label="Niveles del riesgo registrado: de 0 seguro a 5 crítico">
            {RISK_COLORS.map((color, level) => <span key={color} title={`${level} · ${RISK_NAMES[level]}`} style={{ background: color }}/>) }
        </div>
        <div className={styles.levels} aria-hidden="true">{RISK_COLORS.map((color, level) => <span key={color}>{level}</span>)}</div>
        <div className={styles.endpoints} aria-hidden="true"><span>Seguro</span><span>Crítico</span></div>
    </div>;
}

export function TrafficLegend() {
    return <div className={`risk-legend traffic-legend ${styles.legend}`} aria-label="Tráfico en tiempo real">
        <strong className={styles.title}><TrafficCone size={14} aria-hidden="true"/>Tráfico · © TomTom</strong>
        <div className={`traffic-scale ${styles.scale}`} role="img" aria-label="Tráfico fluido en verde, lento en amarillo y congestionado en rojo">
            <span title="Fluido"/><span title="Lento"/><span title="Congestionado"/>
        </div>
        <div className={styles.trafficLabels} aria-hidden="true"><span>Fluido</span><span>Lento</span><span>Congestionado</span></div>
    </div>;
}
