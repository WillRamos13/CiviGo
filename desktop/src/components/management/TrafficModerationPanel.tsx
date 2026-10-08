import { useState } from 'react';
import EditorPanel from '@/components/EditorPanel';
import { api } from '@/lib/api';
import { trafficSnapshot, type ExternalTrafficNotice, type TrafficModeration } from '@/lib/announcements';
import { dateTime, Feedback, message, RemoteStatus, useRemote } from './common';

interface TrafficResponse { incidentes: ExternalTrafficNotice[]; trafico: { disponible: boolean; motivo?: string; actualizadoEn?: string } }
interface Selection { externoId: string; titulo: string; oculto: boolean; datos?: Partial<ExternalTrafficNotice> }

export default function TrafficModerationPanel() {
  const traffic = useRemote<TrafficResponse>('/navigation/traffic/incidents');
  const moderation = useRemote<TrafficModeration[]>('/announcements/traffic-moderation');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [opening, setOpening] = useState(0);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const [success, setSuccess] = useState('');
  function select(value: Selection) { setSelection(value); setReason(''); setOpening(value => value + 1); setFailure(''); setSuccess(''); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!selection || pending) return;
    if (reason.trim().length < 10) { setFailure('Explica el motivo con al menos 10 caracteres.'); return; }
    setPending(true); setFailure(''); setSuccess('');
    try {
      await api('/announcements/traffic-moderation', { method: 'POST', body: JSON.stringify({ externoId: selection.externoId, oculto: selection.oculto, motivo: reason.trim(), datos: selection.datos }) });
      setSelection(null); setSuccess(selection.oculto ? 'Aviso ocultado en CiviGo. La decisión quedó registrada.' : 'Aviso restaurado. Volverá a mostrarse si TomTom todavía lo publica.');
      traffic.reload(); moderation.reload();
    } catch (error) { setFailure(message(error)); } finally { setPending(false); }
  }
  const hidden = moderation.data?.filter(row => row.oculto) ?? [];
  return <>
    <div className="flex flex-wrap justify-between gap-3 mb-5"><p className="muted max-w-xl">Oculta avisos viales incorrectos de TomTom con un motivo. Esta acción no cambia reportes ciudadanos ni los datos originales del proveedor.</p><button className="btn btn-secondary" disabled={pending || traffic.loading || moderation.loading} onClick={() => { traffic.reload(); moderation.reload(); }}>Actualizar avisos</button></div>
    <Feedback error={failure} success={success}/>
    <RemoteStatus loading={traffic.loading} error={traffic.error} retry={traffic.reload}/>
    <RemoteStatus loading={moderation.loading} error={moderation.error} retry={moderation.reload}/>
    {traffic.data && !traffic.loading && !traffic.error && <section className="card"><h2 className="font-bold text-xl mb-4">Avisos actuales de TomTom</h2>{!traffic.data.trafico.disponible && <p className="notice notice-warning">El tráfico actual no está disponible. {traffic.data.trafico.motivo}</p>}{traffic.data.incidentes.length === 0 ? <p className="muted mt-3">No hay avisos viales disponibles para esta consulta.</p> : <div className="divide-y">{traffic.data.incidentes.filter(row => !hidden.some(saved => saved.externoId === row.externoId)).map(row => <article key={row.id} className="py-4 flex flex-wrap justify-between gap-3"><div><h3 className="font-bold">{row.titulo}</h3><p className="mt-2">{row.descripcion}</p><p className="muted text-sm mt-2">{row.tipo} · {row.latitud.toFixed(5)}, {row.longitud.toFixed(5)}</p>{row.inicio && <p className="muted text-sm">Desde {dateTime(row.inicio)}</p>}</div><button className="btn btn-secondary self-start" disabled={pending || moderation.loading || !!moderation.error} onClick={() => select({ externoId: row.externoId, titulo: row.titulo, oculto: true, datos: trafficSnapshot(row) })}>Ocultar aviso</button></article>)}</div>}</section>}
    {moderation.data && !moderation.loading && !moderation.error && <section className="card mt-5"><h2 className="font-bold text-xl mb-4">Decisiones registradas</h2>{moderation.data.length === 0 ? <p className="muted">No hay decisiones de moderación.</p> : <div className="divide-y">{moderation.data.map(row => <article key={row.id} className="py-4 flex flex-wrap justify-between gap-3"><div><h3 className="font-bold">{row.datos?.titulo ?? row.externoId}</h3><p className="mt-2">{row.motivo}</p><p className="muted text-sm mt-2">{row.oculto ? 'Oculto en CiviGo' : 'Restaurado'} · {dateTime(row.actualizadoEn)}</p><p className="muted text-sm">TomTom · {row.externoId}</p></div>{row.oculto && <button className="btn btn-secondary self-start" disabled={pending} onClick={() => select({ externoId: row.externoId, titulo: row.datos?.titulo ?? row.externoId, oculto: false })}>Restaurar aviso</button>}</article>)}</div>}</section>}
    {selection && <EditorPanel label={selection.oculto ? 'Ocultar aviso externo' : 'Restaurar aviso externo'} selectionKey={`${selection.externoId}:${opening}`}><form className="card mt-5 brand-border" onSubmit={save}><h2 className="text-xl font-bold">{selection.oculto ? 'Ocultar' : 'Restaurar'} · {selection.titulo}</h2><label className="field mt-4">Motivo de la decisión<textarea required minLength={10} maxLength={1000} rows={3} disabled={pending} value={reason} onChange={event => setReason(event.target.value)}/></label><p className="muted text-sm mt-3">Se guarda tu identificador y el motivo en la auditoría.</p><div className="flex gap-3 mt-5"><button className="btn btn-primary" disabled={pending}>{pending ? 'Guardando…' : selection.oculto ? 'Confirmar ocultación' : 'Confirmar restauración'}</button><button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setSelection(null)}>Cancelar</button></div></form></EditorPanel>}
  </>;
}
