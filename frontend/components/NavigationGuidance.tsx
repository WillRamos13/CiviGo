'use client';
import { ArrowUp, CornerUpLeft, CornerUpRight, LocateFixed, Volume2, VolumeX, Square, LoaderCircle } from 'lucide-react';
import { formatMeters, type NavigationProgress } from '@/lib/navigation';
import type { Ruta } from '@/lib/types';
import { reliableSpeed, routeTimeSource } from '@/lib/navigation-presentation';
import { useEffect, useState } from 'react';
import styles from './NavigationGuidance.module.css';
export type GuidanceProps = {progress: NavigationProgress | null; notice: string; recalculating: boolean; muted: boolean; toggleMuted: () => void; recenter: () => void; recalculate?: (reason: string) => void};
export default function NavigationGuidance({route, onFinish, progress, notice, recalculating, muted, toggleMuted, recenter, recalculate, compact = false}: GuidanceProps & {route: Ruta; onFinish: () => void; compact?: boolean}) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
    const Icon = progress?.maneuver === 'izquierda' ? CornerUpLeft : progress?.maneuver === 'derecha' ? CornerUpRight : ArrowUp;
    const arrival = progress?.updatedAt ? new Date(progress.updatedAt + progress.secondsRemaining * 1000) : route.llegadaEstimada ? new Date(route.llegadaEstimada) : null;
    const speed = reliableSpeed(progress?.position, now);
    return <section className={`navigation-guidance ${styles.guidance} ${compact ? styles.compact : ''}`} aria-label="Navegación del recorrido" data-compact={compact}>
        {route.copiaGuardada && <p className="navigation-notice">Copia guardada: tiempos y condiciones anteriores. Se intentará actualizar desde tu ubicación cuando haya conexión.</p>}
        <div className={`next-maneuver ${styles.maneuver}`}><Icon size={30} aria-hidden="true"/><div title={progress?.instruction}><strong>{progress ? formatMeters(progress.distanceToTurn) : 'Esperando GPS…'}</strong><p>{progress?.instruction ?? 'Permite el acceso a tu ubicación para iniciar.'}</p></div></div>
        <div className={styles.metrics}><div className={styles.remaining}><strong>{Math.max(1, Math.ceil((progress?.secondsRemaining ?? route.duracion) / 60))} min</strong><span>{formatMeters(progress?.distanceRemaining ?? route.distancia)} · {arrival && Number.isFinite(arrival.getTime()) ? `Llegada ${arrival.toLocaleTimeString('es-PE', {hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima'})}` : 'Llegada pendiente del GPS'}</span></div>
            {speed !== null && <div className={styles.speed} aria-label={`Velocidad GPS ${speed} kilómetros por hora`}><strong>{speed}</strong><small>km/h</small></div>}
            <button type="button" className={styles.finish} onClick={onFinish}><Square size={12} aria-hidden="true"/>Finalizar</button>
        </div>
        <small className={styles.source}>{routeTimeSource(route, now)}</small>
        {notice && <p className={styles.notice} role="status">{recalculating && <LoaderCircle size={13} className="spin"/>}{notice}</p>}
        <div className={`navigation-actions ${styles.controls}`}><button type="button" className="icon-btn" aria-label={muted ? 'Activar voz' : 'Silenciar voz'} onClick={toggleMuted}>{muted ? <VolumeX size={19}/> : <Volume2 size={19}/>}</button><button type="button" className="btn btn-secondary btn-small" onClick={recenter}><LocateFixed size={14}/>Centrar</button>{!compact && recalculate && <button type="button" className="btn btn-secondary btn-small" disabled={recalculating} onClick={() => recalculate('Actualizando el recorrido a petición tuya…')}><LoaderCircle size={13} aria-hidden="true"/>Recalcular</button>}</div>
        {!compact && <small className="muted">Mantén esta página abierta durante el recorrido.</small>}
    </section>;
}
