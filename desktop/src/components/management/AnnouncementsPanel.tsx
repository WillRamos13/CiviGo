import { useState } from 'react';
import EditorPanel from '@/components/EditorPanel';
import { api } from '@/lib/api';
import { peruDateInput, peruDateIso, type MapAnnouncement } from '@/lib/announcements';
import { dateTime, Feedback, message, RemoteStatus, useRemote } from './common';

interface Draft {
  id?: number; tipo: 'NOVEDAD' | 'NEGOCIO'; titulo: string; mensaje: string;
  enlace: string; negocioId: string; activo: boolean; orden: number; inicio: string; fin: string;
}
const emptyDraft: Draft = { tipo: 'NOVEDAD', titulo: '', mensaje: '', enlace: '', negocioId: '', activo: true, orden: 0, inicio: '', fin: '' };

export default function AnnouncementsPanel() {
  const announcements = useRemote<MapAnnouncement[]>('/announcements/manage');
  const businesses = useRemote<{ id: number; nombre: string; activo: boolean }[]>('/admin/businesses');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [opening, setOpening] = useState(0);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const [success, setSuccess] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);
  function edit(row?: MapAnnouncement) {
    setFailure(''); setSuccess(''); setDeleting(null);
    setDraft(row ? { ...row, enlace: row.enlace ?? '', negocioId: row.negocioId ? String(row.negocioId) : '', inicio: peruDateInput(row.inicio), fin: peruDateInput(row.fin) } : { ...emptyDraft });
    setOpening(value => value + 1);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || pending) return;
    setPending(true); setFailure(''); setSuccess('');
    try {
      const inicio = peruDateIso(draft.inicio), fin = peruDateIso(draft.fin);
      if (inicio && fin && fin <= inicio) throw new Error('El fin debe ser posterior al inicio.');
      if (draft.tipo === 'NEGOCIO' && !draft.negocioId) throw new Error('Selecciona un negocio.');
      await api(`/announcements/manage${draft.id ? `/${draft.id}` : ''}`, {
        method: draft.id ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...draft, titulo: draft.titulo.trim(), mensaje: draft.mensaje.trim(), inicio, fin, negocioId: draft.tipo === 'NEGOCIO' ? Number(draft.negocioId) : null, enlace: draft.tipo === 'NOVEDAD' ? draft.enlace.trim() || null : null }),
      });
      setDraft(null); setSuccess('Anuncio guardado. Se mostrará durante su horario programado.'); announcements.reload();
    } catch (error) { setFailure(message(error)); } finally { setPending(false); }
  }
  async function remove(id: number) {
    if (pending) return;
    setPending(true); setFailure(''); setSuccess('');
    try {
      await api(`/announcements/manage/${id}`, { method: 'DELETE' });
      setDeleting(null); if (draft?.id === id) setDraft(null);
      setSuccess('Anuncio eliminado.'); announcements.reload();
    } catch (error) { setFailure(message(error)); } finally { setPending(false); }
  }
  return <>
    <div className="flex flex-wrap justify-between gap-3 mb-5">
      <p className="muted max-w-xl">Anuncios y novedades rotan en el encabezado del mapa. Premium puede ocultar anuncios de negocios; las novedades siguen visibles.</p>
      <div className="flex gap-2"><button className="btn btn-secondary" disabled={pending || announcements.loading} onClick={announcements.reload}>Actualizar</button><button className="btn btn-primary" disabled={pending} onClick={() => edit()}>Crear anuncio</button></div>
    </div>
    <Feedback error={failure} success={success}/>
    <RemoteStatus loading={announcements.loading} error={announcements.error} retry={announcements.reload}/>
    {announcements.data && !announcements.loading && !announcements.error && <section className="card">
      <h2 className="font-bold text-xl mb-4">Anuncios y novedades</h2>
      {announcements.data.length === 0 ? <p className="muted">No hay anuncios creados.</p> : <div className="divide-y">{announcements.data.map(row => <article key={row.id} className="py-4">
        <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-bold">{row.titulo}</h3><p className="mt-2">{row.mensaje}</p><p className="muted mt-2">{row.tipo === 'NEGOCIO' ? `Publicidad · ${row.negocio?.nombre ?? 'Negocio'}` : 'Novedad'} · orden {row.orden} · {row.activo ? 'Habilitado' : 'Desactivado'}</p><p className="muted text-sm mt-2">{row.inicio ? `Desde ${dateTime(row.inicio)}` : 'Sin inicio programado'} · {row.fin ? `Hasta ${dateTime(row.fin)}` : 'Sin fin programado'}</p></div><div className="flex gap-2 self-start"><button className="btn btn-secondary" disabled={pending} onClick={() => edit(row)}>Editar</button><button className="btn btn-secondary" disabled={pending} onClick={() => { setDeleting(row.id); setFailure(''); }}>Eliminar</button></div></div>
        {deleting === row.id && <div className="notice mt-3" role="alert"><p>¿Eliminar «{row.titulo}»? Dejará de aparecer en el mapa.</p><div className="flex gap-2 mt-3"><button className="btn btn-primary" disabled={pending} onClick={() => void remove(row.id)}>Confirmar eliminación</button><button className="btn btn-secondary" disabled={pending} onClick={() => setDeleting(null)}>Cancelar</button></div></div>}
      </article>)}</div>}
    </section>}
    {draft && <EditorPanel label={draft.id ? 'Editar anuncio' : 'Crear anuncio'} selectionKey={`${draft.id ?? 'new'}:${opening}`}><form className="card mt-5 brand-border" onSubmit={save}>
      <h2 className="font-bold text-xl mb-4">{draft.id ? 'Editar anuncio' : 'Nuevo anuncio'}</h2>
      <div className="grid-2"><label className="field">Tipo<select value={draft.tipo} disabled={pending} onChange={event => setDraft({ ...draft, tipo: event.target.value as Draft['tipo'] })}><option value="NOVEDAD">Novedad de CiviGo</option><option value="NEGOCIO">Anuncio de negocio</option></select></label><label className="field">Orden de aparición<input required type="number" min={0} max={10000} step={1} value={draft.orden} disabled={pending} onChange={event => setDraft({ ...draft, orden: Number(event.target.value) })}/></label></div>
      <label className="field mt-4">Título<input required maxLength={120} value={draft.titulo} disabled={pending} onChange={event => setDraft({ ...draft, titulo: event.target.value })}/></label>
      <label className="field mt-4">Mensaje<textarea rows={3} maxLength={500} value={draft.mensaje} disabled={pending} onChange={event => setDraft({ ...draft, mensaje: event.target.value })}/></label>
      {draft.tipo === 'NEGOCIO' ? <><RemoteStatus loading={businesses.loading} error={businesses.error} retry={businesses.reload}/><label className="field mt-4">Negocio<select required value={draft.negocioId} disabled={pending || businesses.loading} onChange={event => setDraft({ ...draft, negocioId: event.target.value })}><option value="">Selecciona un negocio</option>{businesses.data?.map(business => <option key={business.id} value={business.id}>{business.nombre}{business.activo ? '' : ' · desactivado'}</option>)}</select><small>Abre su ficha. Si el negocio está desactivado, el anuncio no se muestra.</small></label></> : <label className="field mt-4">Enlace opcional<input maxLength={500} placeholder="https://… o /mapa" value={draft.enlace} disabled={pending} onChange={event => setDraft({ ...draft, enlace: event.target.value })}/><small>Solo enlaces HTTPS o páginas permitidas de CiviGo.</small></label>}
      <fieldset className="mt-5"><legend className="font-bold mb-3">Programación · hora de Perú</legend><div className="grid-2"><label className="field">Inicio opcional<input type="datetime-local" value={draft.inicio} disabled={pending} onChange={event => setDraft({ ...draft, inicio: event.target.value })}/></label><label className="field">Fin opcional<input type="datetime-local" value={draft.fin} disabled={pending} onChange={event => setDraft({ ...draft, fin: event.target.value })}/></label></div></fieldset>
      <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={draft.activo} disabled={pending} onChange={event => setDraft({ ...draft, activo: event.target.checked })}/>Anuncio habilitado</label>
      <div className="flex gap-3 mt-5"><button className="btn btn-primary" disabled={pending || (draft.tipo === 'NEGOCIO' && (businesses.loading || !!businesses.error))}>{pending ? 'Guardando…' : 'Guardar anuncio'}</button><button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setDraft(null)}>Cancelar</button></div>
    </form></EditorPanel>}
  </>;
}
