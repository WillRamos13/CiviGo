'use client';
import { ArrowUp, CornerUpLeft, CornerUpRight, LocateFixed, Volume2, VolumeX, Square, LoaderCircle } from 'lucide-react';
import { formatMeters, type NavigationProgress } from '@/lib/navigation';
import type { Ruta } from '@/lib/types';
export type GuidanceProps = {progress: NavigationProgress | null; notice: string; recalculating: boolean; muted: boolean; toggleMuted: () => void; recenter: () => void};
export default function NavigationGuidance({route, onFinish, progress, notice, recalculating, muted, toggleMuted, recenter}: GuidanceProps & {route: Ruta; onFinish: () => void}) {
    const Icon = progress?.maneuver === 'izquierda' ? CornerUpLeft : progress?.maneuver === 'derecha' ? CornerUpRight : ArrowUp;
    const arrival = progress?.updatedAt ? new Date(progress.updatedAt + progress.secondsRemaining * 1000) : route.llegadaEstimada ? new Date(route.llegadaEstimada) : null;
    return <section className="navigation-guidance" aria-label="Navegación del recorrido">
        {route.copiaGuardada && <p className="navigation-notice">Copia guardada: tiempos y condiciones anteriores. Se intentará actualizar desde tu ubicación cuando haya conexión.</p>}
        <div className="next-maneuver"><Icon size={30}/><div><strong>{progress ? formatMeters(progress.distanceToTurn) : 'Esperando GPS…'}</strong><p>{progress?.instruction ?? 'Permite el acceso a tu ubicación para iniciar.'}</p></div></div>
        <div className="navigation-summary"><strong>{Math.max(1, Math.ceil((progress?.secondsRemaining ?? route.duracion) / 60))} min</strong><span>{formatMeters(progress?.distanceRemaining ?? route.distancia)}</span><span>{arrival && Number.isFinite(arrival.getTime()) ? `Llegada ${arrival.toLocaleTimeString('es-PE', {hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima'})}` : 'Llegada pendiente del GPS'}</span></div>
        {notice && <p className="navigation-notice" role="status">{recalculating && <LoaderCircle size={13} className="spin"/>}{notice}</p>}
        <div className="navigation-actions"><button className="icon-btn" aria-label={muted ? 'Activar voz' : 'Silenciar voz'} onClick={toggleMuted}>{muted ? <VolumeX size={19}/> : <Volume2 size={19}/>}</button><button className="btn btn-secondary btn-small" onClick={recenter}><LocateFixed size={14}/>Centrar</button><button className="btn btn-secondary btn-small" onClick={onFinish}><Square size={12}/>Finalizar</button></div>
        <small className="muted">Mantén esta página abierta durante el recorrido.</small>
    </section>;
}
