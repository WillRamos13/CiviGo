import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useDialog } from '../../hooks/useDialog';
import { getIncidentDetail } from '../../services/incidentDetails';
import { errorMessage } from '../../services/api';
import { IncidentDetailModal } from './IncidentDetailModal';
import type { Incidente } from '../../types';

export function IncidentFromAlert({ id, onClose }: { id: number; onClose: () => void }) {
  const { usuario } = useAuth();
  const owner = useRef(usuario?.id);
  const close = useRef(onClose); close.current = onClose;
  const [incident, setIncident] = useState<Incidente | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const currentOwner = owner.current === usuario?.id;
  const identity = `${usuario?.id}:${usuario?.rol}:${usuario?.bloqueado}`;
  const dialog = useDialog<HTMLDivElement>(currentOwner && !incident, onClose);
  useEffect(() => {
    if (!currentOwner) { close.current(); return; }
    const controller = new AbortController();
    setIncident(null); setError('');
    void getIncidentDetail(id, controller.signal).then(value => {
      if (!controller.signal.aborted) setIncident(value);
    }).catch(failure => {
      if (!controller.signal.aborted) setError(errorMessage(failure));
    });
    return () => controller.abort();
  }, [id, identity, attempt, currentOwner]);
  if (!currentOwner) return null;
  if (incident) return <IncidentDetailModal incidente={incident} onClose={onClose} onRefresh={() => setAttempt(value => value + 1)} />;
  return <div className="chatbot-modal" onClick={onClose}>
    <div ref={dialog} tabIndex={-1} className="chatbot-sheet" role="dialog" aria-modal="true" aria-label="Detalle del incidente del aviso" onClick={event => event.stopPropagation()}>
      <h2>Detalle del incidente</h2>
      {error ? <><p role="alert">{error}</p><button type="button" className="btn btn-secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar detalle</button></>
        : <p role="status">Cargando incidente…</p>}
      <button type="button" className="btn btn-primary" onClick={onClose}>Cerrar detalle</button>
    </div>
  </div>;
}
