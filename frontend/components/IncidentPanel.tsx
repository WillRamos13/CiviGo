'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import IncidentIcon from '@/components/IncidentIcon';
import { X, Check, Flag, MessageCircle, MapPin } from 'lucide-react';
import { api, post, currentPosition, errorMessage, formatDate } from '@/lib/api';
import { useAuth } from './AuthProvider';
import { canParticipate } from '@/lib/session';
import type { Incidente, Mensaje } from '@/lib/types';
import { isHistoricalAntecedent, incidentSource, incidentEvaluationLabel } from '@/lib/incidents';
export default function IncidentPanel({ incidente, onClose, onRefresh }: {
    incidente: Incidente;
    onClose: () => void;
    onRefresh: () => void;
}) {
    const { usuario } = useAuth();
    const panelRef=useRef<HTMLElement|null>(null),closeRef=useRef(onClose);
    useEffect(()=>{closeRef.current=onClose;},[onClose]);
    const [detail, setDetail] = useState(incidente), [messages, setMessages] = useState<Mensaje[]>([]), [text, setText] = useState(''), [flag, setFlag] = useState(''), [reason, setReason] = useState(''), [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false);
    const reload = useCallback(async () => { const [d, m] = await Promise.allSettled([api<Incidente>(`/incidents/${incidente.id}`), api<Mensaje[]>(`/incidents/${incidente.id}/chat`)]); if (d.status === 'fulfilled')
        setDetail(d.value); if (m.status === 'fulfilled')
        setMessages(m.value); }, [incidente.id]);
    useEffect(() => { void Promise.resolve().then(reload); const timer = setInterval(reload, 15000); return () => clearInterval(timer); }, [reload]);
    useEffect(() => {
        const previous=document.body.style.overflow,previousFocus=document.activeElement as HTMLElement|null;
        document.body.style.overflow='hidden';
        panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        const keyboard=(event:KeyboardEvent)=>{
            if(event.key==='Escape'){closeRef.current();return;}
            if(event.key!=='Tab')return;
            const nodes=panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled])');
            if(!nodes?.length)return;
            const first=nodes[0],last=nodes[nodes.length-1];
            if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
            if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
        };
        document.addEventListener('keydown',keyboard);
        return()=>{document.body.style.overflow=previous;document.removeEventListener('keydown',keyboard);previousFocus?.focus();};
    },[]);
    const act = async (action: () => Promise<unknown>, message: string) => { setError(''); setSuccess(''); setBusy(true); try {
        await action();
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
    return <div className="modal-backdrop" onClick={onClose}><section ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="incident-title" onClick={e => e.stopPropagation()}><div className="modal-title"><div><span className="eyebrow">INCIDENTE #{detail.id}</span><div className="incident-title-with-icon"><IncidentIcon tipo={detail.tipoNombre || detail.tipo} slug={detail.tipoSlug} size={40}/><h2 id="incident-title" style={{ marginTop: 9 }}>{detail.tipoNombre || detail.tipo}</h2></div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar detalle"><X /></button></div><div className="card"><div className="actions"><span className="badge">{detail.estado}</span><span className="badge">{incidentEvaluationLabel(detail)}</span>{antecedent && <span className="badge">Antecedente histórico</span>}<span className="badge">Gravedad: {gravity == null ? 'por evaluar' : gravity}</span>{individual && <span className="badge">Reporte individual</span>}</div><p style={{ marginTop: 18, whiteSpace: 'pre-wrap' }}>{detail.descripcion || 'Sin descripción adicional.'}</p><div className="report-meta"><span><MapPin size={12} style={{ display: 'inline' }}/> {detail.latitud.toFixed(5)}, {detail.longitud.toFixed(5)}</span><span>Ocurrió: {antecedent ? detail.fechaEvento ? formatDate(detail.fechaEvento) : 'Fecha del hecho no indicada' : formatDate(detail.fechaEvento || detail.fechaCreacion || detail.creadoEn || detail.fecha)}</span>{source && <span>Procedencia: {source}</span>}{detail.fechaPublicacion && <span>Publicado: {formatDate(detail.fechaPublicacion)}</span>}</div>{antecedent && <div className="notice" style={{ margin: '14px 0' }}>Este registro corresponde a un hecho pasado y aporta antecedentes al riesgo del tramo.</div>}<div className="grid-2"><div><small className="muted">Aportes agrupados</small><h3 style={{ marginTop: 5 }}>{detail.totalReportes ?? 1}</h3></div><div><small className="muted">{individual ? 'Revisión de pruebas privadas' : 'Confirmaciones ciudadanas'}</small><h3 style={{ marginTop: 5 }}>{individual ? detail.estado === 'VALIDADO' ? 'Validado por un agente' : 'Pendiente de validación' : `${count} / 3`}</h3></div></div><p className="muted" style={{ fontSize: 11 }}>La gravedad del incidente y el nivel de la calle son valores diferentes. La IA ofrece una evaluación preliminar; no certifica la autenticidad del hecho o de los archivos. La validación depende de la revisión de un agente o de las confirmaciones ciudadanas que correspondan.</p>{detail.adjuntos?.some(a => !a.privado && a.url) && <div className="media-list">{detail.adjuntos.filter(a => !a.privado && a.url).map(a => a.mimeType.startsWith('video/') ? <video key={a.id} src={a.url!} controls preload="metadata"/> : <a href={a.url!} key={a.id} target="_blank" rel="noopener noreferrer"><Image src={a.url!} alt="Fotografía pública del incidente" width={160} height={110} unoptimized/></a>)}</div>}</div>{error && <div className="notice notice-error" role="alert">{error}</div>}{success && <div className="notice notice-success" role="status">{success}</div>}{canParticipate(usuario) ? <div className="card"><h3>Ayuda a verificar este incidente</h3>{!individual && ["ACTIVO", "VALIDADO", "PENDIENTE"].includes(detail.estado) && <><p className="muted" style={{ fontSize: 12 }}>Confirmar o marcar como resuelto requiere estar a 50 metros o menos. Una persona puede confirmar una sola vez.</p><div className="actions"><button className="btn btn-primary btn-small" disabled={busy} onClick={() => nearby('confirmar')}><Check size={14}/>Sigue ocurriendo</button><button className="btn btn-secondary btn-small" disabled={busy} onClick={() => nearby('resolver')}>Ya se resolvió</button></div></>}{["RESUELTO", "RETIRADO"].includes(detail.estado) && <button className="btn btn-secondary btn-small" disabled={busy} onClick={() => nearby("reabrir")}>Solicitar reapertura</button>}{individual && <p className="muted" style={{ fontSize: 12 }}>Este delito se valida mediante las pruebas privadas del autor. No recibe confirmaciones comunitarias.</p>}<button className="btn btn-quiet btn-small" style={{ marginTop: 12 }} onClick={() => setFlag(flag ? '' : 'FALSO')}><Flag size={13}/>Solicitar revisión</button>{flag && <form onSubmit={e => { e.preventDefault(); void act(() => post(`/incidents/${detail.id}/flags`, { tipo: flag, motivo: reason }), 'Tu solicitud fue enviada a revisión. El incidente permanece visible durante la investigación.'); }}><div className="field"><label>Motivo de revisión</label><select value={flag} onChange={e => setFlag(e.target.value)}><option value="FALSO">Creo que es un reporte falso</option><option value="NO_ENCONTRADO">No encontré el incidente</option></select><textarea value={reason} onChange={e => setReason(e.target.value)} required minLength={5} maxLength={1000} placeholder="Explica lo que observaste"/></div><button className="btn btn-secondary btn-small" disabled={busy}>Enviar a un agente</button></form>}</div> : <div className="notice">{usuario?.bloqueado ? 'Tu cuenta está restringida para participar. Puedes solicitar revisión en Mis reportes.' : usuario ? 'Verifica tu Gmail con Google para participar.' : 'Inicia sesión para participar.'} <Link href={usuario?.bloqueado ? '/mis-reportes' : usuario ? '/verificar' : '/ingresar'} style={{ fontWeight: 700, textDecoration: 'underline' }}>Continuar</Link></div>}<div className="card"><div className="card-header"><h3><MessageCircle size={16} style={{ display: 'inline', marginRight: 6 }}/>Conversación del incidente</h3><span className="badge">{chatOpen ? 'Abierto' : 'Cerrado'}</span></div>{individual && <p className="muted" style={{ fontSize: 11 }}>El chat de un delito individual está disponible durante siete días desde su publicación. Nunca publiques documentos privados aquí.</p>}<div className="chat-list">{messages.length === 0 ? <p className="muted" style={{ fontSize: 12 }}>Todavía no hay mensajes.</p> : messages.map(m => <article className="chat-message" key={m.id}><strong>{m.usuario?.nickname || m.nickname || 'Ciudadano'}</strong><p>{m.mensaje}</p><time>{formatDate(m.creadoEn)}</time></article>)}</div>{chatOpen && canParticipate(usuario) && <form onSubmit={e => { e.preventDefault(); void act(async () => { await post(`/incidents/${detail.id}/chat`, { mensaje: text }); setText(''); }, 'Mensaje enviado.'); }}><div className="field"><label htmlFor="chat-message">Tu mensaje</label><textarea id="chat-message" value={text} onChange={e => setText(e.target.value)} maxLength={1000} minLength={2} required placeholder="Comparte información útil sobre este incidente"/></div><button className="btn btn-primary btn-small" disabled={busy || !text.trim()}>Enviar</button></form>}</div></section></div>;
}
