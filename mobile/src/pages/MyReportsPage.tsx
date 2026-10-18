import React, { useState, useEffect, useCallback } from 'react';
import { AuthGate } from '../components/layout/AuthGate';
import { useAuth } from '../hooks/useAuth';
import { useOperationScope } from '../hooks/useOperationScope';
import { IncidentIcon } from '../components/map/IncidentIcon';
import { AuthenticatedMedia } from '../components/incident/AuthenticatedMedia';
import { api, post, formatDate, errorMessage } from '../services/api';
import { PRIVATE_EVIDENCE_ACCEPT, canRequestReportReview, canAddPrivateEvidence, remainingEvidenceSlots, submitPrivateEvidence } from '../services/reportFollowup';
import { useDialog } from '../hooks/useDialog';
import { triggerHaptic } from '../services/native';
import { RefreshCw, FileText, Upload, MessageSquare } from 'lucide-react';
import type { Reporte } from '../types';

interface MyReportsPageProps {
  onGoLogin: () => void;
  onGoRegister: () => void;
  onGoReport: () => void;
}

export const MyReportsPage: React.FC<MyReportsPageProps> = ({
  onGoLogin,
  onGoRegister,
  onGoReport,
}) => {
  const { usuario } = useAuth();
  const requestId = React.useRef(0);
  const [reports, setReports] = useState<Reporte[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeReport, setActiveReport] = useState<Reporte | null>(null);
  const [appealReason, setAppealReason] = useState('');
  const [busyAppeal, setBusyAppeal] = useState(false);
  const [proofReportId, setProofReportId] = useState<number | null>(null);
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const [busyProof, setBusyProof] = useState(false);
  const [message, setMessage] = useState('');
  const operations = useOperationScope(`${usuario?.id ?? 'guest'}:${activeReport?.id ?? 'list'}:${proofReportId ?? 'none'}`);
  const appealDialog = useDialog<HTMLDivElement>(!!activeReport, () => { if (!busyAppeal) setActiveReport(null); });
  const submittingProof = React.useRef(false);

  const loadReports = useCallback(async () => {
    const request = ++requestId.current;
    if (!usuario) { setReports([]); setLoading(false); setError(''); return; }
    setLoading(true);
    setError('');
    try {
      const data = await api<Reporte[]>('/reports/mine');
      if (request === requestId.current) setReports(data || []);
    } catch (err) {
      if (request === requestId.current) setError(errorMessage(err));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [usuario?.id]);

  useEffect(() => {
    setReports([]);
    setActiveReport(null);
    setProofReportId(null); setProofFiles([]);
    void loadReports();
    return () => { ++requestId.current; };
  }, [loadReports]);

  useEffect(() => {
    setBusyAppeal(false);
    setAppealReason('');
  }, [usuario?.id, activeReport?.id]);

  useEffect(() => { setMessage(''); }, [usuario?.id]);
  useEffect(() => { setBusyProof(false); setProofFiles([]); }, [usuario?.id, proofReportId]);

  const handleAddEvidence = async (report: Reporte) => {
    if (submittingProof.current || !canAddPrivateEvidence(report, usuario)) return;
    const operation = operations.begin();
    submittingProof.current = true;
    setBusyProof(true); setError(''); setMessage('');
    try {
      const updated = await submitPrivateEvidence(report, proofFiles, operation);
      operation.assertActive();
      setReports(previous => previous.map(item => item.id === updated.id ? updated : item));
      setMessage('Pruebas privadas enviadas. Un agente revisará los nuevos archivos.');
      setProofReportId(null); setProofFiles([]);
    } catch (err) {
      if (operation.isActive()) setError(errorMessage(err));
    } finally {
      submittingProof.current = false;
      if (operation.isActive()) setBusyProof(false);
      operation.finish();
    }
  };

  const handleSendAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReport || appealReason.trim().length < 10 || busyAppeal || !canRequestReportReview(activeReport)) return;
    const operation = operations.begin();
    void triggerHaptic('medium');
    setBusyAppeal(true);
    setError('');
    setMessage('');

    try {
      operation.assertActive();
      await post(`/reports/${activeReport.id}/appeal`, {
        motivo: appealReason.trim(),
      }, { signal: operation.signal });
      operation.assertActive();
      setMessage('Solicitud de revisión enviada. Un administrador la revisará.');
      setActiveReport(null);
      setAppealReason('');
      void loadReports();
    } catch (err) {
      if (operation.isActive()) setError(errorMessage(err));
    } finally {
      if (operation.isActive()) setBusyAppeal(false);
      operation.finish();
    }
  };

  return (
    <div className="page" style={{ paddingBottom: 'calc(40px + var(--safe-bottom))' }}>
      <div className="page-heading">
        <span className="eyebrow">HISTORIAL CIUDADANO</span>
        <h1>Mis reportes</h1>
        <p className="muted">Consulta el estado de evaluación y revisión de tus aportes en Ica.</p>
      </div>

      <AuthGate onGoLogin={onGoLogin} onGoRegister={onGoRegister}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span className="badge">{reports.length} reportes registrados</span>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={loadReports}
            disabled={loading || busyProof || busyAppeal}
          >
            <RefreshCw size={14} className={loading ? 'pulse' : ''} />
            <span>Actualizar</span>
          </button>
        </div>

        {error && !activeReport && <div className="notice notice-error">{error}</div>}
        {message && <div className="notice notice-success">{message}</div>}

        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
            <p className="muted">Cargando tus reportes…</p>
          </div>
        ) : reports.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '36px 16px' }}>
            <FileText size={36} color="var(--brand)" style={{ margin: '0 auto 12px' }} />
            <h2>No tienes reportes activos</h2>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              Aún no has reportado incidentes en tu zona. Tu colaboración ayuda a mantener segura a tu comunidad.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onGoReport}
            >
              Crear mi primer reporte
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reports.map((r) => {
              const statusColor =
                r.estado === 'VALIDADO'
                  ? 'var(--success-bg)'
                  : r.estado === 'FALSO'
                  ? 'var(--error-bg)'
                  : 'var(--brand-soft)';

              const statusTextColor =
                r.estado === 'VALIDADO'
                  ? 'var(--success-ink)'
                  : r.estado === 'FALSO'
                  ? 'var(--error-ink)'
                  : 'var(--badge-ink)';

              return (
                <article key={r.id} className="card" style={{ padding: '14px', margin: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <IncidentIcon tipo={r.tipo} size={36} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <strong style={{ fontSize: 14 }}>Reporte #{r.id} · {r.tipo}</strong>
                        <span
                          className="badge"
                          style={{ backgroundColor: statusColor, color: statusTextColor, fontSize: 10 }}
                        >
                          {r.estado}
                        </span>
                      </div>

                      {r.descripcion && (
                        <p className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>
                          {r.descripcion}
                        </p>
                      )}

                      <span className="muted" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
                        {formatDate(r.fechaEvento || r.fechaCreacion || r.creadoEn)}
                      </span>
                      {!!r.adjuntos?.length && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                        {r.adjuntos.filter((attachment) => attachment.url).map((attachment) => <div key={attachment.id} style={{ width: 100, height: 100, overflow: 'hidden', borderRadius: 8 }}>
                          <AuthenticatedMedia url={attachment.url!} mimeType={attachment.mimeType} privado={attachment.privado}
                            controls alt="Evidencia de tu reporte" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        </div>)}
                      </div>}

                      {/* Appeal notices if present */}
                      {r.apelaciones && r.apelaciones.length > 0 && (
                        <div style={{ marginTop: 8, padding: 8, borderRadius: 6, backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--line)' }}>
                          {r.apelaciones.map(appeal => <div key={appeal.id} style={{ marginBottom: 6 }}>
                            <small style={{ fontWeight: 700, display: 'block' }}>Revisión solicitada: {appeal.estado}</small>
                            <small className="muted">{appeal.motivo}</small>
                            {appeal.respuesta && <small style={{ display: 'block' }}>Respuesta: {appeal.respuesta}</small>}
                          </div>)}
                        </div>
                      )}

                        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {canAddPrivateEvidence(r, usuario) && <button type="button" className="btn btn-secondary btn-small" disabled={busyProof || busyAppeal}
                            onClick={() => { setProofReportId(proofReportId === r.id ? null : r.id); setActiveReport(null); setError(''); }}>
                            <Upload size={13} />Aportar pruebas privadas
                          </button>}
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            disabled={busyProof || busyAppeal || !canRequestReportReview(r)}
                            onClick={() => { setActiveReport(r); setProofReportId(null); setError(''); }}
                          >
                            <MessageSquare size={13} />
                            <span>Solicitar revisión del reporte</span>
                          </button>
                        </div>
                      {proofReportId === r.id && <form style={{ marginTop: 12 }} onSubmit={event => { event.preventDefault(); void handleAddEvidence(r); }}>
                        <label className="field">Fotos, videos o PDF para revisión privada
                          <input type="file" accept={PRIVATE_EVIDENCE_ACCEPT} multiple disabled={busyProof} onChange={event => {
                            const picked = Array.from(event.target.files || []);
                            event.target.value = '';
                            if (picked.length > remainingEvidenceSlots(r)) { setProofFiles([]); setError(`Quedan ${remainingEvidenceSlots(r)} espacios para archivos en este reporte.`); return; }
                            setProofFiles(picked); setError('');
                          }} />
                        </label>
                        <small className="muted">Hasta 15 MB por archivo. Espacios disponibles: {remainingEvidenceSlots(r)}. Estas pruebas no se publican en el mapa.</small>
                        {proofFiles.length > 0 && <ul>{proofFiles.map((file, index) => <li key={`${file.name}:${index}`}><small>{file.name}</small></li>)}</ul>}
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button type="submit" className="btn btn-primary btn-small" disabled={busyProof || !proofFiles.length}>{busyProof ? 'Enviando pruebas…' : 'Enviar pruebas privadas'}</button>
                          <button type="button" className="btn btn-quiet btn-small" disabled={busyProof} onClick={() => setProofReportId(null)}>Cancelar</button>
                        </div>
                      </form>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Appeal Form Modal */}
        {activeReport && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'var(--backdrop)',
              zIndex: 70,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <div ref={appealDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Solicitar revisión del reporte" className="card" style={{ width: '100%', maxWidth: 450, margin: 0 }}>
              <div className="card-header">
                <h3>Solicitar revisión de Reporte #{activeReport.id}</h3>
              </div>
              {error && <div className="notice notice-error">{error}</div>}
              <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                Explica las razones por las cuales consideras que el reporte debe ser reevaluado por el equipo de administración.
              </p>

              <form onSubmit={handleSendAppeal}>
                <div className="field">
                  <label htmlFor="appeal-reason">Motivo de apelación</label>
                  <textarea
                    id="appeal-reason"
                    value={appealReason}
                    onChange={(e) => setAppealReason(e.target.value)}
                    required
                    minLength={10}
                    maxLength={1000}
                    placeholder="Describe tus argumentos con claridad..."
                  />
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => setActiveReport(null)}
                    disabled={busyAppeal}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    disabled={busyAppeal || appealReason.trim().length < 10}
                  >
                    {busyAppeal ? 'Enviando…' : 'Enviar solicitud'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </AuthGate>
    </div>
  );
};
