'use client';
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import IncidentIcon from '@/components/IncidentIcon';
import { X, Check, Flag, MessageCircle, MapPin, FileText, Activity, ExternalLink } from 'lucide-react';
import styles from './IncidentPanel.module.css';
import { api, post, currentPosition, errorMessage, formatDate, ApiError } from '@/lib/api';
import { useAuth } from './AuthProvider';
import { canParticipate } from '@/lib/session';
import type { Incidente, Mensaje } from '@/lib/types';
import { isHistoricalAntecedent, incidentSource, incidentEvaluationLabel } from '@/lib/incidents';
export default function IncidentPanel({ incidente, onClose, onRefresh, variant = 'dialog', onShowOnMap }: {
    incidente: Incidente;
    onClose: () => void;
    onRefresh: () => void;
    variant?: 'dialog' | 'map-card';
    onShowOnMap?: () => void;
}) {
    const { usuario } = useAuth();
    const compact = variant === 'map-card';
    const panelRef=useRef<HTMLElement|null>(null),closeRef=useRef(onClose),detailRequest=useRef<AbortController|null>(null);
    useEffect(()=>{closeRef.current=onClose;},[onClose]);
    const [detail, setDetail] = useState(incidente), [messages, setMessages] = useState<Mensaje[]>([]), [text, setText] = useState(''), [flag, setFlag] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState(''), [refreshError, setRefreshError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false);
    const reload = useCallback(async () => {
        // Let a slow poll finish instead of cancelling it every fifteen seconds.
        if (detailRequest.current) return;
        const controller = new AbortController();
        detailRequest.current = controller;
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
        const [d, m] = await Promise.allSettled([
            api<Incidente>(`/incidents/${incidente.id}`, {signal}),
            api<Mensaje[]>(`/incidents/${incidente.id}/chat`, {signal}),
        ]);
        if (controller.signal.aborted || detailRequest.current !== controller) return;
        detailRequest.current = null;
        if (d.status === 'fulfilled') {
            setDetail(d.value);
            setRefreshError('');
        } else if (d.reason instanceof ApiError && d.reason.status === 404) {
            // Nearby reports may not be in the general map's capped response.
            // Visibility is determined by the detail endpoint, not by the list.
            closeRef.current();
            return;
        } else {
            setRefreshError('No se pudo actualizar el detalle. Se conservan los últimos datos obtenidos; pueden estar desactualizados.');
        }
        if (m.status === 'fulfilled') setMessages(m.value);
    }, [incidente.id]);
    useEffect(() => {
        let active = true;
        void Promise.resolve().then(() => { if (active) void reload(); });
        const timer = setInterval(() => { void reload(); }, 15000);
        return () => { active = false; clearInterval(timer); detailRequest.current?.abort(); detailRequest.current = null; };
    }, [reload]);
    useLayoutEffect(() => {
        const panel=panelRef.current;
        const previous=document.body.style.overflow,previousFocus=document.activeElement as HTMLElement|null;
        if (!compact) document.body.style.overflow='hidden';
        panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        const keyboard=(event:KeyboardEvent)=>{
            if(event.key==='Escape' && (!compact || panelRef.current?.contains(document.activeElement))){closeRef.current();return;}
            if(event.key!=='Tab' || compact)return;
            const nodes=panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled])');
            if(!nodes?.length)return;
            const first=nodes[0],last=nodes[nodes.length-1];
            if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
            if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
        };
        document.addEventListener('keydown',keyboard);
        return()=>{
            const restoreFocus = !compact || !!panel?.contains(document.activeElement);
            if (!compact) document.body.style.overflow=previous;
            document.removeEventListener('keydown',keyboard);
            if (restoreFocus) previousFocus?.focus({preventScroll:true});
        };
    },[compact]);
    const act = async (action: () => Promise<unknown>, message: string) => { setError(''); setSuccess(''); setBusy(true); try {
        await action();
        detailRequest.current?.abort();
        detailRequest.current = null;
        await reload();
        onRefresh();
        setSuccess(message);
    }
    catch (err) {
        setError(errorMessage(err));
    }
    finally {
        setBusy(false);
    } };
    const nearby = (action: string) => act(async () => post(`/incidents/${detail.id}/${action}`, await currentPosition()), action === 'confirmar' ? 'Tu confirmación fue registrada.' : action === 'reabrir' ? 'Se envió la solicitud de reapertura. Un agente revisará el incidente.' : 'Tu evaluación de resolución fue registrada.');
    const individual = detail.individual ?? ['robo', 'hurto', 'intento-de-robo', 'amenazas', 'extorsion'].includes(detail.tipo.toLowerCase().replaceAll(' ', '-'));
    const gravity = detail.gravedad ?? detail.nivelRiesgo;
    const chatOpen = detail.chatAbierto !== false && (!['RESUELTO', 'RETIRADO', 'FALSO'].includes(detail.estado) || individual);
    const count = Array.isArray(detail.confirmaciones) ? detail.confirmaciones.length : detail.confirmaciones ?? 0;
    const antecedent = isHistoricalAntecedent(detail), source = incidentSource(detail);
    const media = (detail.adjuntos ?? []).filter(a => !a.privado && a.url && (a.mimeType.startsWith('image/') || a.mimeType.startsWith('video/')));
    const cover = media[0];
    const timestamp = detail.fechaEvento || detail.fechaCreacion || detail.creadoEn || detail.fecha;
    const stateLabel: Record<string, string> = { ACTIVO: 'Activo', VALIDADO: 'Validado', PENDIENTE: 'En verificación', RESUELTO: 'Resuelto', RETIRADO: 'Retirado', FALSO: 'Declarado falso' };
    return <div className={compact ? styles.mapCardPosition : 'modal-backdrop'} onClick={compact ? undefined : onClose}>
        <section ref={panelRef} className={(compact ? styles.mapCard : 'modal-panel') + ' ' + styles.card} role="dialog" aria-modal={!compact} aria-labelledby="incident-title" onClick={e => e.stopPropagation()}>
            <header className={styles.heading}>
                <IncidentIcon tipo={detail.tipoNombre || detail.tipo} slug={detail.tipoSlug} size={42}/>
                <div><h2 id="incident-title">{detail.tipoNombre || detail.tipo}</h2><time dateTime={timestamp}>{formatDate(timestamp)} · #{detail.id}</time></div>
                <button className="icon-btn" onClick={onClose} aria-label="Cerrar detalle"><X size={20}/></button>
            </header>
            <div className={styles.body}>
                {cover && <div className={styles.cover}>{cover.mimeType.startsWith('video/') ? <video src={cover.url!} controls preload="metadata"/> : <a href={cover.url!} target="_blank" rel="noopener noreferrer"><Image src={cover.url!} alt={'Fotografía pública: ' + (detail.tipoNombre || detail.tipo)} width={640} height={360} unoptimized/></a>}</div>}
                <dl className={styles.information}>
                    <div><dt><MapPin size={20}/>Ubicación</dt><dd>{detail.distrito || 'Provincia de Ica'}<small>{detail.latitud.toFixed(5)}, {detail.longitud.toFixed(5)}</small>{onShowOnMap && <button type="button" className={styles.mapLink} onClick={onShowOnMap}>Ver en el mapa <ExternalLink size={13}/></button>}</dd></div>
                    <div><dt><FileText size={20}/>Tipo de incidente</dt><dd>{detail.tipoNombre || detail.tipo}</dd></div>
                    <div><dt><Activity size={20}/>Estado</dt><dd><span className={styles.state} data-state={detail.estado}>{stateLabel[detail.estado] || detail.estado}</span>{detail.publicado === false && <small>No visible en el mapa</small>}</dd></div>
                    <div><dt><FileText size={20}/>Descripción</dt><dd className={styles.description}>{detail.descripcion || 'Sin descripción adicional.'}</dd></div>
                </dl>
                <details className={styles.validation}>
                    <summary>Validación y aportes · gravedad {gravity == null ? 'por evaluar' : gravity}</summary>
                    <div className="actions"><span className="badge">{incidentEvaluationLabel(detail)}</span>{antecedent && <span className="badge">Antecedente histórico</span>}{individual && <span className="badge">Reporte individual</span>}</div>
                    <div className="report-meta"><span>Ocurrió: {antecedent && !detail.fechaEvento ? 'Fecha del hecho no indicada' : formatDate(timestamp)}</span>{source && <span>Procedencia: {source}</span>}{detail.fechaPublicacion && <span>Publicado: {formatDate(detail.fechaPublicacion)}</span>}</div>
                    {antecedent && <p className="notice">Este registro corresponde a un hecho pasado y aporta antecedentes al riesgo del tramo.</p>}
                    <div className="grid-2"><div><small className="muted">Aportes agrupados</small><h3>{detail.totalReportes ?? 1}</h3></div><div><small className="muted">{individual ? 'Revisión de pruebas privadas' : 'Confirmaciones ciudadanas'}</small><h3>{individual ? detail.estado === 'VALIDADO' ? 'Validado por un agente' : 'Pendiente de validación' : count + ' / 3'}</h3></div></div>
                    <p className="muted">La gravedad del incidente y el nivel de la calle son valores diferentes. La IA ofrece una evaluación preliminar; no certifica la autenticidad del hecho o de los archivos. La validación depende de la revisión de un agente o de las confirmaciones ciudadanas que correspondan.</p>
                </details>
                {media.length > 1 && <div className="media-list">{media.slice(1).map(a => a.mimeType.startsWith('video/') ? <video key={a.id} src={a.url!} controls preload="metadata"/> : <a href={a.url!} key={a.id} target="_blank" rel="noopener noreferrer"><Image src={a.url!} alt="Otra fotografía pública del incidente" width={160} height={110} unoptimized/></a>)}</div>}
                {refreshError && <div className="notice notice-warning" role="status">{refreshError}</div>}
                {error && <div className="notice notice-error" role="alert">{error}</div>}
                {success && <div className="notice notice-success" role="status">{success}</div>}
                {canParticipate(usuario) ? <div className={styles.participation}>
                    <h3>Ayuda a verificar este incidente</h3>
                    {!individual && ["ACTIVO", "VALIDADO", "PENDIENTE"].includes(detail.estado) && <><p className="muted">Confirmar o marcar como resuelto requiere estar a 50 metros o menos. Una persona puede confirmar una sola vez.</p><div className="actions"><button className="btn btn-primary btn-small" disabled={busy} onClick={() => nearby('confirmar')}><Check size={14}/>Sigue ocurriendo</button><button className="btn btn-secondary btn-small" disabled={busy} onClick={() => nearby('resolver')}>Ya se resolvió</button></div></>}
                    {["RESUELTO", "RETIRADO"].includes(detail.estado) && <button className="btn btn-secondary btn-small" disabled={busy} onClick={() => nearby("reabrir")}>Solicitar reapertura</button>}
                    {individual && <p className="muted">Este delito se valida mediante las pruebas privadas del autor. No recibe confirmaciones comunitarias.</p>}
                    <button className="btn btn-quiet btn-small" onClick={() => setFlag(flag ? '' : 'FALSO')}><Flag size={13}/>Solicitar revisión</button>
                    {flag && <form onSubmit={e => { e.preventDefault(); void act(() => post('/incidents/' + detail.id + '/flags', { tipo: flag, motivo: reason }), 'Tu solicitud fue enviada a revisión. El incidente permanece visible durante la investigación.'); }}>
                        <div className="field"><label htmlFor="incident-flag">Motivo de revisión</label><select id="incident-flag" value={flag} onChange={e => setFlag(e.target.value)}><option value="FALSO">Creo que es un reporte falso</option><option value="NO_ENCONTRADO">No encontré el incidente</option></select><textarea aria-label="Descripción del motivo de revisión" value={reason} onChange={e => setReason(e.target.value)} required minLength={5} maxLength={1000} placeholder="Explica lo que observaste"/></div><button className="btn btn-secondary btn-small" disabled={busy}>Enviar a un agente</button>
                    </form>}
                </div> : <div className="notice">{usuario?.bloqueado ? 'Tu cuenta está restringida para participar. Puedes solicitar revisión en Mis reportes.' : usuario ? 'Verifica tu Gmail con Google para participar.' : 'Inicia sesión para participar.'} <Link href={usuario?.bloqueado ? '/mis-reportes' : usuario ? '/verificar' : '/ingresar'}>Continuar</Link></div>}
                <div className={styles.conversation}>
                    <div className="card-header"><h3><MessageCircle size={16}/>Conversación del incidente</h3><span className="badge">{chatOpen ? 'Abierto' : 'Cerrado'}</span></div>
                    {individual && <p className="muted">El chat de un delito individual está disponible durante siete días desde su publicación. Nunca publiques documentos privados aquí.</p>}
                    <div className="chat-list">{messages.length === 0 ? <p className="muted">Todavía no hay mensajes.</p> : messages.map(m => <article className="chat-message" key={m.id}><strong>{m.usuario?.nickname || m.nickname || 'Ciudadano'}</strong><p>{m.mensaje}</p><time>{formatDate(m.creadoEn)}</time></article>)}</div>
                    {chatOpen && canParticipate(usuario) && <form onSubmit={e => { e.preventDefault(); void act(async () => { await post('/incidents/' + detail.id + '/chat', { mensaje: text }); setText(''); }, 'Mensaje enviado.'); }}><div className="field"><label htmlFor="chat-message">Tu mensaje</label><textarea id="chat-message" value={text} onChange={e => setText(e.target.value)} maxLength={1000} minLength={2} required placeholder="Comparte información útil sobre este incidente"/></div><button className="btn btn-primary btn-small" disabled={busy || !text.trim()}>Enviar</button></form>}
                </div>
            </div>
        </section>
    </div>;
}
