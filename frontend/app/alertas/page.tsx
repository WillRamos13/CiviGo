'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Bell, Check, RefreshCw } from 'lucide-react';
import AuthGate from '@/components/AuthGate';
import { api, errorMessage, formatDate } from '@/lib/api';
type Alert = {
    id: number;
    titulo: string;
    mensaje: string;
    tipo: string;
    leida: boolean;
    creadoEn: string;
    incidenteId?: number | null;
};
function Notifications() {
    const [data, setData] = useState<Alert[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [unread, setUnread] = useState(false);
    const loadRequest = useRef<AbortController | null>(null);
    const load = useCallback(async () => { loadRequest.current?.abort(); const controller = new AbortController(); loadRequest.current = controller; try {
        const alerts = await api<Alert[]>('/notifications', {signal: controller.signal}); if (controller.signal.aborted) return; setData(alerts);
        setError('');
    }
    catch (e) {
        if (!controller.signal.aborted) setError(errorMessage(e));
    }
    finally {
        if (!controller.signal.aborted) setLoading(false);
    } }, []);
    useEffect(() => { let current = true; void Promise.resolve().then(() => { if (current) void load(); }); const timer = setInterval(load, 30000); return () => { current = false; clearInterval(timer); loadRequest.current?.abort(); }; }, [load]);
    const read = async (id: number) => { try {
        await api(`/notifications/${id}/read`, { method: 'PUT' });
        setData(rows => rows.map(r => r.id === id ? { ...r, leida: true } : r));
    }
    catch (e) {
        setError(errorMessage(e));
    } };
    return <>{error && <div className="notice notice-error" role="alert">{error}</div>}<div className="card-header"><label className="inline-checkbox"><input type="checkbox" checked={unread} onChange={e => setUnread(e.target.checked)}/>Solo sin leer</label><button className="btn btn-secondary btn-small" onClick={load}><RefreshCw size={14}/>Actualizar</button></div>{loading ? <div className="card">Cargando avisos…</div> : data.length === 0 ? <div className="card empty"><Bell size={32} color="var(--brand)" style={{ margin: '0 auto 15px' }}/><h2>Todo al día</h2><p>Aquí aparecerán avisos de revisiones, pruebas y novedades relacionadas con tu cuenta.</p></div> : data.filter(a => !unread || !a.leida).map(a => <article className="card" key={a.id} style={{ borderLeft: a.leida ? undefined : '3px solid var(--brand)' }}><div className="card-header"><h3>{a.titulo}</h3><span className="badge">{a.leida ? 'Leída' : 'Nueva'}</span></div><p>{a.mensaje}</p><small className="muted">{formatDate(a.creadoEn)}</small><div className="actions" style={{ marginTop: 16 }}>{a.incidenteId && <Link className="btn btn-secondary btn-small" href={`/incidentes/${a.incidenteId}`}>Ver incidente</Link>}{!a.leida && <button className="btn btn-quiet btn-small" onClick={() => read(a.id)}><Check size={13}/>Marcar como leída</button>}</div></article>)}</>;
}
export default function Page() { return <div className="page" style={{ maxWidth: 900 }}><div className="page-heading"><span className="eyebrow">INFORMACIÓN PARA TI</span><h1>Alertas y avisos</h1><p>Los avisos durante el recorrido aparecen en el mapa mientras la web está abierta.</p></div><AuthGate><Notifications /></AuthGate></div>; }
