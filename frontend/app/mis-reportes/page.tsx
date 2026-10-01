'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { FileText, RefreshCw, Lock, Upload } from 'lucide-react';
import AuthGate from '@/components/AuthGate';
import IncidentIcon from '@/components/IncidentIcon';
import { useAuth } from '@/components/AuthProvider';
import { api, post, errorMessage, formatDate, upload } from '@/lib/api';
import type { Reporte } from '@/lib/types';
function Reports() {
    const { usuario, refresh } = useAuth();
    const [reports, setReports] = useState<Reporte[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [active, setActive] = useState<number | null>(null), [proofs, setProofs] = useState<File[]>([]), [reason, setReason] = useState(''), [appeal, setAppeal] = useState<number | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [filter, setFilter] = useState('');
    const loadRequest = useRef<AbortController | null>(null);
    const load = useCallback(async () => { loadRequest.current?.abort(); const controller = new AbortController(); loadRequest.current = controller; try {
        const reports = await api<Reporte[]>('/reports/mine', {signal: controller.signal}); if (controller.signal.aborted) return; setReports(reports);
        setError('');
    }
    catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e));
    }
    finally {
        if (!controller.signal.aborted) setLoading(false);
    } }, []);
    useEffect(() => { let current = true; void Promise.resolve().then(() => { if (current) void load(); }); return () => { current = false; loadRequest.current?.abort(); }; }, [load]);
    const evidence = async (r: Reporte) => { setBusy(true); setError(''); try {
        if (proofs.length === 0 || proofs.length > 3)
            throw new Error('Selecciona de una a tres pruebas.');
        const ids = [];
        for (const f of proofs)
            ids.push((await upload(f, true, 'EVIDENCIA')).id);
        await post(`/reports/${r.id}/evidence`, { adjuntosIds: ids });
        setMessage('Pruebas privadas enviadas. Un agente autorizado las revisará.');
        setActive(null);
        setProofs([]);
        await load();
    }
    catch (e) {
        setError(errorMessage(e));
    }
    finally {
        setBusy(false);
    } };
    return <>{usuario?.bloqueado && <div className="notice notice-warning" role="status">Tu cuenta está bloqueada para participar. Puedes consultar tus reportes y solicitar revisión de las decisiones.</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}{message && <div className="notice notice-success" role="status">{message}</div>}<div className="card"><div className="card-header"><h2>Tus aportes a la comunidad</h2><button className="icon-btn" onClick={async () => { await load(); await refresh(); }} aria-label="Actualizar reportes"><RefreshCw size={17}/></button></div><div className="grid-2"><div className="field"><label htmlFor="estado">Estado</label><select id="estado" value={filter} onChange={e => setFilter(e.target.value)}><option value="">Todos</option>{Array.from(new Set(reports.map(r => r.estado))).map(s => <option key={s}>{s}</option>)}</select></div><p className="muted" style={{ fontSize: 12 }}>Tus pruebas privadas se muestran solamente a ti y al personal autorizado. Retirar un incidente del mapa conserva su registro y las decisiones.</p></div></div>{loading ? <div className="card">Cargando tus reportes…</div> : reports.length === 0 ? <div className="card empty"><FileText size={32} color="var(--brand)" style={{ margin: '0 auto 16px' }}/><h2>Tu primer aporte está por venir</h2><p>Cuando reportes un incidente, podrás seguir su estado desde aquí.</p><Link className="btn btn-primary" href="/reportar">Reportar un incidente</Link></div> : reports.filter(r => !filter || r.estado === filter).map(r => <article className="card report-card" key={r.id}><div className="card-header"><div className="incident-title-with-icon"><IncidentIcon tipo={r.tipo} slug={r.incidente?.tipoSlug} size={40}/><h3>{r.tipo} <small className="muted">#{r.id}</small></h3></div><span className="badge">{r.estado}</span></div><p style={{ whiteSpace: 'pre-wrap' }}>{r.descripcion}</p><div className="report-meta"><span>Ocurrió: {formatDate(r.fechaEvento)}</span><span>Enviado: {formatDate(r.fechaCreacion || r.creadoEn || r.fecha)}</span>{(r.incidente?.fechaPublicacion || r.fechaPublicacion) && <span>Publicado: {formatDate(r.incidente?.fechaPublicacion || r.fechaPublicacion)}</span>}<span>{r.latitud.toFixed(5)}, {r.longitud.toFixed(5)}</span></div>{r.incidente?.motivoRetiro && <div className="notice notice-warning">{r.incidente.motivoRetiro}</div>}{r.incidente?.individual && <div className="notice"><Lock size={13} style={{ display: 'inline', marginRight: 5 }}/>Delito individual. Presenta pruebas dentro de siete días desde la publicación. A los tres días sin pruebas, su peso se reduce; al séptimo día sin pruebas puede retirarse del mapa. Si entregas pruebas privadas dentro del plazo, permanece visible mientras un agente las revisa.</div>}{r.adjuntos?.length !== 0 && <div className="stack" style={{ margin: '12px 0' }}>{r.adjuntos?.map(a => <a key={a.id} href={a.url || '#'} target="_blank" rel="noopener noreferrer" className="file-chip" style={{ width: 'fit-content' }}>{a.privado ? <Lock size={12}/> : <FileText size={12}/>} {a.nombre} <span className="muted">{a.privado ? 'Privado' : 'Público'}</span></a>)}</div>}<div className="actions">{r.incidenteId && <Link href={`/incidentes/${r.incidenteId}`} className="btn btn-secondary btn-small">Ver incidente y chat</Link>}{usuario?.telefonoVerificado && !usuario.bloqueado && <button className="btn btn-secondary btn-small" onClick={() => { setActive(active === r.id ? null : r.id); setProofs([]); }}><Upload size={13}/>Aportar pruebas privadas</button>}<button className="btn btn-quiet btn-small" onClick={() => { setAppeal(appeal === r.id ? null : r.id); setReason(''); }}>Solicitar revisión</button></div>{active === r.id && <div style={{ marginTop: 18 }}><div className="field"><label>Pruebas para revisión privada</label><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/webm,video/quicktime" multiple onChange={e => { const list = Array.from(e.target.files || []); if (list.length > 3 || list.some(f => f.size > 15 * 1024 * 1024)) {
        setError('Máximo tres archivos, hasta 15 MB cada uno.');
        e.target.value = '';
        return;
    } setProofs(list); }}/><small>Documentos, fotos o videos de hasta 30 segundos. Máximo 15 MB por archivo. No se publican en el mapa.</small></div><button className="btn btn-primary btn-small" disabled={busy || proofs.length === 0} onClick={() => evidence(r)}>{busy ? 'Enviando…' : 'Enviar pruebas'}</button></div>}{appeal === r.id && <form style={{ marginTop: 18 }} onSubmit={async (e) => { e.preventDefault(); setBusy(true); try {
        await post(`/reports/${r.id}/appeal`, { motivo: reason });
        setMessage('Solicitud de revisión enviada al personal autorizado.');
        setAppeal(null);
    }
    catch (e) {
        setError(errorMessage(e));
    }
    finally {
        setBusy(false);
    } }}><div className="field"><label>Explica tu solicitud</label><textarea minLength={10} maxLength={2000} required value={reason} onChange={e => setReason(e.target.value)}/></div><button className="btn btn-primary btn-small" disabled={busy}>Enviar solicitud</button></form>}</article>)}</>;
}
export default function Page() { return <div className="page"><div className="page-heading"><span className="eyebrow">SEGUIMIENTO PERSONAL</span><h1>Mis reportes</h1><p>Consulta tus aportes, presenta pruebas y sigue sus revisiones.</p></div><AuthGate><Reports /></AuthGate></div>; }
