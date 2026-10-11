import { useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '@/lib/api';
import { dateTime, message, useRemote } from './management/common';

interface Notice { id: number; titulo: string; mensaje: string; tipo: string; leida: boolean; incidenteId?: number | null; creadoEn: string; }
export default function NotificationsPanel() {
  const remote = useRemote<Notice[]>('/notifications');
  const [open, setOpen] = useState(false), [busy, setBusy] = useState<number | null>(null), [error, setError] = useState('');
  const rows = remote.data ?? [], unread = rows.filter(row => !row.leida), urgent = unread.filter(row => row.tipo === 'REVISION').length;
  async function read(id: number) {
    setBusy(id); setError('');
    try { await api(`/notifications/${id}/read`, { method: 'PUT', body: '{}' }); remote.reload(); }
    catch (failure) { setError(message(failure)); } finally { setBusy(null); }
  }
  return <div className="desktop-notifications">
    <button type="button" className="btn btn-secondary" aria-expanded={open} aria-controls="desktop-notices" onClick={() => setOpen(value => !value)}><Bell size={17}/>Alertas {unread.length > 0 && <strong>{unread.length}</strong>}</button>
    <span className="sr-only" role="status" aria-live="polite">{urgent > 0 ? `${urgent} avisos requieren revisión.` : ''}</span>
    {open && <section id="desktop-notices" className="card notification-tray" aria-label="Alertas de administración">
      <div className="flex justify-between gap-3"><h2>Alertas y revisiones</h2><button className="btn btn-secondary" disabled={remote.loading} onClick={remote.reload}>Actualizar</button></div>
      {(error || remote.error || remote.refreshError) && <p className="notice notice-error" role="alert">{error || remote.error || remote.refreshError}</p>}
      {remote.loading && !remote.data && <p role="status">Cargando alertas…</p>}
      {!remote.loading && rows.length === 0 && !remote.error && <p className="muted">No hay alertas registradas.</p>}
      {rows.map(row => <article className="py-3 border-b" key={row.id}>
        <strong>{row.titulo}</strong>{!row.leida && <span className="badge ml-2">{row.tipo === 'REVISION' ? 'Requiere revisión' : 'Nueva'}</span>}
        <p className="my-2">{row.mensaje}</p><small className="muted">{dateTime(row.creadoEn)}{row.incidenteId ? ` · Incidente #${row.incidenteId}` : ''}</small>
        {!row.leida && <div className="mt-2"><button className="btn btn-secondary" disabled={busy !== null} onClick={() => void read(row.id)}>{busy === row.id ? 'Guardando…' : 'Marcar como leída'}</button></div>}
      </article>)}
      <p className="muted text-sm mt-3">Marcar una alerta como leída no valida ni cierra el incidente. Revísalo en la pestaña Incidentes.</p>
    </section>}
  </div>;
}
