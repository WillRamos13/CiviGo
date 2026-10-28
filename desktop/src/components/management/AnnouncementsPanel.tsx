import { useRef, useState } from 'react';
import headerTemplate from '../../../public/banners/rewards-header.webp?inline';
import wideTemplate from '../../../public/banners/rewards-wide.webp?inline';
import portraitTemplate from '../../../public/banners/rewards-portrait.webp?inline';
import EditorPanel from '@/components/EditorPanel';
import AnnouncementImagePreview from '@/components/AnnouncementImagePreview';
import { api, upload } from '@/lib/api';
import { announcementPlacementLabel, peruDateInput, peruDateIso, validateAnnouncementImage, type AnnouncementPlacement, type MapAnnouncement } from '@/lib/announcements';
import { dateTime, Feedback, message, RemoteStatus, useRemote } from './common';

interface Draft {
  id?: number; tipo: 'NOVEDAD' | 'NEGOCIO'; titulo: string; mensaje: string;
  ubicacion: AnnouncementPlacement;
  enlace: string; negocioId: string; activo: boolean; orden: number; inicio: string; fin: string;
  imagenId: string | null; imagenAlt: string;
}
const emptyDraft: Draft = { tipo: 'NOVEDAD', ubicacion: 'CABECERA', titulo: '', mensaje: '', enlace: '', negocioId: '', activo: true, orden: 0, inicio: '', fin: '', imagenId: null, imagenAlt: '' };

export default function AnnouncementsPanel() {
  const [placement, setPlacement] = useState<AnnouncementPlacement | ''>('');
  const announcements = useRemote<MapAnnouncement[]>('/announcements/manage' + (placement ? '?ubicacion=' + placement : ''));
  const businesses = useRemote<{ id: number; nombre: string; activo: boolean }[]>('/admin/businesses');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [opening, setOpening] = useState(0);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const [success, setSuccess] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);
  const stagedImages = useRef(new Set<string>());
  async function cleanupStaged() {
    for (const imageId of stagedImages.current) {
      try { await api(`/uploads/${imageId}`, { method: 'DELETE' }); stagedImages.current.delete(imageId); }
      catch { /* The normal abandoned-upload cleanup can retry later. */ }
    }
  }
  async function edit(row?: MapAnnouncement) {
    if (pending) return;
    setPending(true); await cleanupStaged(); setPending(false);
    setFailure(''); setSuccess(''); setDeleting(null);
    setDraft(row ? { ...row, ubicacion: row.ubicacion ?? 'CABECERA', imagenId: row.imagenId ?? null, imagenAlt: row.imagenAlt ?? '', enlace: row.enlace ?? '', negocioId: row.negocioId ? String(row.negocioId) : '', inicio: peruDateInput(row.inicio), fin: peruDateInput(row.fin) } : { ...emptyDraft, ubicacion: placement || 'CABECERA' });
    setOpening(value => value + 1);
  }
  async function chooseImage(file?: File) {
    if (!file || !draft || pending) return;
    setFailure(''); setSuccess('');
    try { validateAnnouncementImage(file); } catch (error) { setFailure(message(error)); return; }
    setPending(true);
    try {
      const image = await upload(file, false, 'ANUNCIO');
      stagedImages.current.add(image.id);
      const previousId = draft.imagenId;
      setDraft({ ...draft, imagenId: image.id });
      if (previousId && stagedImages.current.has(previousId)) {
        try { await api(`/uploads/${previousId}`, { method: 'DELETE' }); stagedImages.current.delete(previousId); } catch { /* Retry on save/cancel or through abandoned-upload cleanup. */ }
      }
    } catch (error) { setFailure(message(error)); } finally { setPending(false); }
  }
  async function chooseTemplate(name: string) {
    if(!draft||pending)return;
    setPending(true);setFailure('');
    try {
      const source=({'rewards-header.webp':headerTemplate,'rewards-wide.webp':wideTemplate,'rewards-portrait.webp':portraitTemplate} as Record<string,string>)[name];
      if(!source?.startsWith('data:image/webp;base64,'))throw new Error('No se pudo leer la plantilla.');
      const bytes=Uint8Array.from(atob(source.split(',')[1]),character=>character.charCodeAt(0));
      const file=new File([bytes],name,{type:'image/webp'});
      validateAnnouncementImage(file);
      const image=await upload(file,false,'ANUNCIO');stagedImages.current.add(image.id);
      const previousId=draft.imagenId;
      setDraft(current=>current?{...current,imagenId:image.id,imagenAlt:name.includes('portrait')?'Tu aporte cuenta. Reporta, participa y suma puntos.':'Participa, suma puntos y descubre recompensas en CiviGo.',titulo:'Tu aporte cuenta',mensaje:'Participa en tu comunidad y descubre recompensas.',enlace:'/registro'}:current);
      if(previousId&&stagedImages.current.has(previousId)){try{await api('/uploads/'+previousId,{method:'DELETE'});stagedImages.current.delete(previousId);}catch{/* Cleanup retries on save. */}}
    }catch(reason){setFailure(message(reason));}finally{setPending(false);}
  }
  async function cancel() {
    if (pending) return;
    setPending(true); await cleanupStaged(); setDraft(null); setPending(false);
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
      if (draft.imagenId) stagedImages.current.delete(draft.imagenId);
      await cleanupStaged();
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
      <p className="muted max-w-xl">Publica texto e imágenes en la barra superior o en el lateral de Reportar. Premium puede ocultar anuncios de negocios; las novedades siguen visibles.</p>
      <div className="flex gap-2"><button className="btn btn-secondary" disabled={pending || announcements.loading} onClick={announcements.reload}>Actualizar</button><button className="btn btn-primary" disabled={pending} onClick={() => edit()}>Crear anuncio</button></div>
    </div>
    <Feedback error={failure} success={success}/>
    <label className="field mb-4">Filtrar por ubicación<select value={placement} disabled={pending} onChange={event => setPlacement(event.target.value as AnnouncementPlacement | '')}><option value="">Todas las ubicaciones</option><option value="CABECERA">Barra superior</option><option value="REPORTAR">Lateral de Reportar</option></select></label>
    <RemoteStatus loading={announcements.loading} error={announcements.error} retry={announcements.reload}/>
    {announcements.data && !announcements.loading && !announcements.error && <section className="card">
      <h2 className="font-bold text-xl mb-4">Anuncios y novedades</h2>
      {announcements.data.length === 0 ? <p className="muted">No hay anuncios creados.</p> : <div className="divide-y">{announcements.data.map(row => <article key={row.id} className="py-4">
        <div className="flex flex-wrap justify-between gap-3"><div><h3 className="font-bold">{row.titulo}</h3><p className="mt-2">{row.mensaje}</p>{row.imagen && <p className="muted text-sm mt-2">Imagen: {row.imagen.nombre} · editar para previsualizar</p>}<p className="muted mt-2">{row.tipo === 'NEGOCIO' ? `Publicidad · ${row.negocio?.nombre ?? 'Negocio'}` : 'Novedad'} · {announcementPlacementLabel(row.ubicacion)} · orden {row.orden} · {row.activo ? 'Habilitado' : 'Desactivado'}</p><p className="muted text-sm mt-2">{row.inicio ? `Desde ${dateTime(row.inicio)}` : 'Sin inicio programado'} · {row.fin ? `Hasta ${dateTime(row.fin)}` : 'Sin fin programado'}</p></div><div className="flex gap-2 self-start"><button className="btn btn-secondary" disabled={pending} onClick={() => edit(row)}>Editar</button><button className="btn btn-secondary" disabled={pending} onClick={() => { setDeleting(row.id); setFailure(''); }}>Eliminar</button></div></div>
        {deleting === row.id && <div className="notice mt-3" role="alert"><p>¿Eliminar «{row.titulo}»? Dejará de aparecer en CiviGo.</p><div className="flex gap-2 mt-3"><button className="btn btn-primary" disabled={pending} onClick={() => void remove(row.id)}>Confirmar eliminación</button><button className="btn btn-secondary" disabled={pending} onClick={() => setDeleting(null)}>Cancelar</button></div></div>}
      </article>)}</div>}
    </section>}
    {draft && <EditorPanel label={draft.id ? 'Editar anuncio' : 'Crear anuncio'} selectionKey={`${draft.id ?? 'new'}:${opening}`}><form className="card mt-5 brand-border" onSubmit={save}>
      <h2 className="font-bold text-xl mb-4">{draft.id ? 'Editar anuncio' : 'Nuevo anuncio'}</h2>
      <label className="field mb-4">Ubicación del anuncio<select value={draft.ubicacion} disabled={pending} onChange={event => setDraft({ ...draft, ubicacion: event.target.value as AnnouncementPlacement })}><option value="CABECERA">Barra superior</option><option value="REPORTAR">Lateral de Reportar</option></select><small>El banner lateral acompaña el formulario de Reportar; los anuncios existentes permanecen en la barra superior.</small></label>
      <div className="grid-2"><label className="field">Tipo<select value={draft.tipo} disabled={pending} onChange={event => setDraft({ ...draft, tipo: event.target.value as Draft['tipo'] })}><option value="NOVEDAD">Novedad de CiviGo</option><option value="NEGOCIO">Anuncio de negocio</option></select></label><label className="field">Orden de aparición<input required type="number" min={0} max={10000} step={1} value={draft.orden} disabled={pending} onChange={event => setDraft({ ...draft, orden: Number(event.target.value) })}/></label></div>
      <div className="announcement-templates"><strong>Plantillas de CiviGo</strong><div className="actions"><button type="button" className="btn btn-secondary" disabled={pending} onClick={()=>void chooseTemplate('rewards-header.webp')}>Cabecera</button><button type="button" className="btn btn-secondary" disabled={pending} onClick={()=>void chooseTemplate('rewards-wide.webp')}>Horizontal</button><button type="button" className="btn btn-secondary" disabled={pending} onClick={()=>void chooseTemplate('rewards-portrait.webp')}>Lateral / celular</button></div><small>Selecciona la ubicación del anuncio y guarda para publicarlo.</small></div><label className="field">Título<input required maxLength={120} value={draft.titulo} disabled={pending} onChange={event => setDraft({ ...draft, titulo: event.target.value })}/></label>
      <label className="field mt-4">Mensaje<textarea rows={3} maxLength={500} value={draft.mensaje} disabled={pending} onChange={event => setDraft({ ...draft, mensaje: event.target.value })}/></label>
      <fieldset className="mt-5"><legend className="font-bold mb-3">Imagen publicitaria opcional</legend>
        <label className="field">{draft.imagenId ? 'Reemplazar imagen' : 'Agregar imagen'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={pending} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void chooseImage(file); }}/><small>JPEG, PNG, WebP o GIF, hasta 5 MB. {draft.ubicacion === 'REPORTAR' ? 'Para el lateral puedes usar un banner vertical.' : 'Para la barra superior usa una imagen horizontal.'} Se mostrará completa.</small></label>
        {draft.imagenId && <div className="mt-3"><AnnouncementImagePreview id={draft.imagenId} alt={draft.imagenAlt || draft.titulo || 'Vista previa del anuncio'}/><label className="field mt-3">Descripción de la imagen<input maxLength={250} value={draft.imagenAlt} disabled={pending} placeholder="Describe la promoción para lectores de pantalla" onChange={event => setDraft({ ...draft, imagenAlt: event.target.value })}/><small>Si lo dejas vacío se utiliza el título del anuncio.</small></label><button type="button" className="btn btn-secondary mt-3" disabled={pending} onClick={() => setDraft({ ...draft, imagenId: null, imagenAlt: '' })}>Quitar imagen</button></div>}
      </fieldset>
      {draft.tipo === 'NEGOCIO' ? <><RemoteStatus loading={businesses.loading} error={businesses.error} retry={businesses.reload}/><label className="field mt-4">Negocio<select required value={draft.negocioId} disabled={pending || businesses.loading} onChange={event => setDraft({ ...draft, negocioId: event.target.value })}><option value="">Selecciona un negocio</option>{businesses.data?.map(business => <option key={business.id} value={business.id}>{business.nombre}{business.activo ? '' : ' · desactivado'}</option>)}</select><small>Abre su ficha. Si el negocio está desactivado, el anuncio no se muestra.</small></label></> : <label className="field mt-4">Enlace opcional<input maxLength={500} placeholder="https://… o /mapa" value={draft.enlace} disabled={pending} onChange={event => setDraft({ ...draft, enlace: event.target.value })}/><small>Solo enlaces HTTPS o páginas permitidas de CiviGo.</small></label>}
      <fieldset className="mt-5"><legend className="font-bold mb-3">Programación · hora de Perú</legend><div className="grid-2"><label className="field">Inicio opcional<input type="datetime-local" value={draft.inicio} disabled={pending} onChange={event => setDraft({ ...draft, inicio: event.target.value })}/></label><label className="field">Fin opcional<input type="datetime-local" value={draft.fin} disabled={pending} onChange={event => setDraft({ ...draft, fin: event.target.value })}/></label></div></fieldset>
      <label className="flex items-center gap-2 mt-5"><input type="checkbox" checked={draft.activo} disabled={pending} onChange={event => setDraft({ ...draft, activo: event.target.checked })}/>Anuncio habilitado</label>
      <div className="flex gap-3 mt-5"><button className="btn btn-primary" disabled={pending || (draft.tipo === 'NEGOCIO' && (businesses.loading || !!businesses.error))}>{pending ? 'Procesando…' : 'Guardar anuncio'}</button><button type="button" className="btn btn-secondary" disabled={pending} onClick={() => void cancel()}>Cancelar</button></div>
    </form></EditorPanel>}
  </>;
}
