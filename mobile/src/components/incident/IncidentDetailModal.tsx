import React, { useState, useEffect } from 'react';
import { X, CheckCircle, MessageSquare, Send, Shield, AlertTriangle, Image as ImageIcon, Flag, CheckCheck } from 'lucide-react';
import { IncidentIcon } from '../map/IncidentIcon';
import {getIncidentIconPath} from '../../services/incidentIcons';
import { AuthenticatedMedia } from './AuthenticatedMedia';
import { api, post, formatDate, errorMessage } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { useOperationScope } from '../../hooks/useOperationScope';
import { useDialog } from '../../hooks/useDialog';
import { incidentAfterParticipation, resolutionMessage, submitProximityAction } from '../../services/incidentParticipation';
import { mergeIncidentMessages } from '../../services/incidentMessages';
import { triggerHaptic, getCurrentPosition } from '../../services/native';
import { resolveMediaUrl } from '../../services/media';
import { RISK_COLORS, RISK_NAMES } from '../../types';
import type { Incidente, Mensaje } from '../../types';

interface IncidentDetailModalProps {
  incidente: Incidente;
  onClose: () => void;
  onRefresh?: () => void;
}

export const IncidentDetailModal: React.FC<IncidentDetailModalProps> = ({
  incidente: suppliedIncident,
  onClose,
  onRefresh,
}) => {
  const { usuario } = useAuth();
  const [participation, setParticipation] = useState<{ source: Incidente; userId: number; incident: Incidente } | null>(null);
  const incidente = participation?.source === suppliedIncident && participation.userId === usuario?.id
    ? participation.incident : suppliedIncident;
  const operations = useOperationScope(`${usuario?.id ?? 'guest'}:${incidente.id}`);
  const [comments, setComments] = useState<Mensaje[]>([]);
  const [commentText, setCommentText] = useState('');
  const [busyConfirm, setBusyConfirm] = useState(false);
  const [busyResolve, setBusyResolve] = useState(false);
  const [busyFlag, setBusyFlag] = useState(false);
  const [busyComment, setBusyComment] = useState(false);
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagType, setFlagType] = useState<'FALSO' | 'NO_ENCONTRADO' | 'REAPERTURA'>('NO_ENCONTRADO');
  const [flagReason, setFlagReason] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'info' | 'chat'>('info');
  const [chatError, setChatError] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const dialogRef = useDialog<HTMLDivElement>(true, () => showFlagModal ? setShowFlagModal(false) : onClose());

  useEffect(() => {
    setCommentText(''); setFlagReason(''); setShowFlagModal(false); setMessage(''); setError('');
    setBusyConfirm(false); setBusyResolve(false); setBusyFlag(false); setBusyComment(false);
  }, [incidente.id, usuario?.id]);

  const riskLevel = incidente.gravedad ?? incidente.nivelRiesgo;
  const knownRisk = !incidente.porEvaluar && incidente.evaluacion !== 'PENDIENTE'
    && typeof riskLevel === 'number' && Number.isInteger(riskLevel)
    && riskLevel >= 0 && riskLevel < RISK_COLORS.length;
  const riskColor = knownRisk ? RISK_COLORS[riskLevel!] : 'var(--muted)';
  const riskName = knownRisk ? RISK_NAMES[riskLevel!] : 'Por evaluar';

  // Load chat messages from the official backend /incidents/:id/chat
  useEffect(() => {
    let active = true;
    setComments([]);
    setChatError('');
    if (!usuario) return;
    setChatLoading(true);
    api<Mensaje[]>(`/incidents/${incidente.id}/chat`)
      .then((data) => {
        if (active) setComments((current) => mergeIncidentMessages(data, current));
      })
      .catch((err) => { if (active) setChatError(errorMessage(err)); })
      .finally(() => { if (active) setChatLoading(false); });
    return () => {
      active = false;
    };
  }, [incidente.id, usuario?.id]);

  const handleConfirm = async () => {
    if (busyConfirm || busyResolve) return;
    if (!usuario) {
      setError('Inicia sesión para confirmar este incidente.');
      return;
    }
    if (!usuario.correoVerificado) {
      setError('Tu cuenta requiere tener el Gmail verificado para confirmar incidentes.');
      return;
    }
    const operation = operations.begin();
    void triggerHaptic('medium');
    setBusyConfirm(true);
    setError('');
    setMessage('');
    try {
      const result = await submitProximityAction(incidente.id, 'confirmar', operation, {
        locate: () => getCurrentPosition(),
        send: (path, body, options) => post(path, body, options),
      });
      const updated = incidentAfterParticipation(incidente, result);
      if (!updated) throw new Error('No se pudo confirmar el estado actualizado del incidente. Actualiza sus detalles.');
      setParticipation({ source: suppliedIncident, userId: usuario.id, incident: updated });
      setMessage('¡Confirmación registrada con éxito!');
      onRefresh?.();
    } catch (err) {
      if (operation.isActive()) setError(errorMessage(err));
    } finally {
      if (operation.isActive()) setBusyConfirm(false);
      operation.finish();
    }
  };

  const handleResolve = async () => {
    if (busyConfirm || busyResolve) return;
    if (!usuario) {
      setError('Inicia sesión para resolver este incidente.');
      return;
    }
    if (!usuario.correoVerificado) {
      setError('Tu cuenta requiere tener el Gmail verificado para resolver incidentes.');
      return;
    }
    const operation = operations.begin();
    void triggerHaptic('medium');
    setBusyResolve(true);
    setError('');
    setMessage('');
    try {
      const result = await submitProximityAction(incidente.id, 'resolver', operation, {
        locate: () => getCurrentPosition(),
        send: (path, body, options) => post(path, body, options),
      });
      const updated = incidentAfterParticipation(incidente, result);
      if (!updated) throw new Error('No se pudo confirmar el estado actualizado del incidente. Actualiza sus detalles.');
      setParticipation({ source: suppliedIncident, userId: usuario.id, incident: updated });
      setMessage(resolutionMessage(updated));
      onRefresh?.();
    } catch (err) {
      if (operation.isActive()) setError(errorMessage(err));
    } finally {
      if (operation.isActive()) setBusyResolve(false);
      operation.finish();
    }
  };

  const handleSendFlag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (flagReason.trim().length < 5) return setError('El aviso debe explicar lo ocurrido con al menos 5 caracteres.');
    if (!usuario || !usuario.correoVerificado) {
      setError('Debes tener tu correo verificado para señalar incidentes.');
      return;
    }
    if (busyFlag) return;
    const operation = operations.begin();
    void triggerHaptic('medium');
    setBusyFlag(true);
    setError('');
    try {
      operation.assertActive();
      await post(`/incidents/${incidente.id}/flags`, {
        tipo: flagType,
        motivo: flagReason.trim(),
      }, { signal: operation.signal });
      operation.assertActive();
      setMessage('Aviso enviado al equipo de seguridad de CiviGo para su revisión.');
      setShowFlagModal(false);
      setFlagReason('');
    } catch (err) {
      if (operation.isActive()) setError(errorMessage(err));
    } finally {
      if (operation.isActive()) setBusyFlag(false);
      operation.finish();
    }
  };

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    if (!usuario) {
      setError('Inicia sesión para conversar en el chat comunitario.');
      return;
    }
    if (!usuario.correoVerificado) {
      setError('Debes verificar tu Gmail para participar en el chat del incidente.');
      return;
    }
    if (busyComment) return;
    const operation = operations.begin();
    void triggerHaptic('light');
    setBusyComment(true);
    setError('');
    try {
      operation.assertActive();
      const res = await post<Mensaje>(`/incidents/${incidente.id}/chat`, {
        mensaje: commentText.trim(),
      }, { signal: operation.signal });
      operation.assertActive();
      setComments((prev) => mergeIncidentMessages(prev, [res]));
      setCommentText('');
    } catch (err) {
      if (operation.isActive()) setError(errorMessage(err));
    } finally {
      if (operation.isActive()) setBusyComment(false);
      operation.finish();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'var(--backdrop)',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Detalle del incidente"
        className="map-bottom-sheet"
        style={{ maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bottom-sheet-handle" />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IncidentIcon
              tipo={incidente.tipoNombre || incidente.tipo}
              slug={incidente.tipoSlug}
              size={40}
            />
            <div>
              <h2 style={{ fontSize: 17, margin: 0 }}>{incidente.tipoNombre || incidente.tipo}</h2>
              <span className="muted" style={{ fontSize: 11 }}>
                {incidente.distrito ? `Distrito de ${incidente.distrito} · ` : ''}
                {formatDate(incidente.fechaEvento || incidente.fechaCreacion)}
              </span>
            </div>
          </div>

          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        {/* Badges Row */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          <span
            className="badge"
            style={{ backgroundColor: riskColor, color: '#fff' }}
          >
            {riskName}
          </span>
          <span className="badge badge-warning">
            {incidente.estado === 'PUBLICADO' ? 'Alerta activa' : incidente.estado}
          </span>
          {incidente.evaluacion && (
            <span className="badge">
              Evaluación: {incidente.evaluacion === 'PENDIENTE' ? 'Pendiente' : incidente.evaluacion === 'IA' ? 'Asistida por IA' : incidente.evaluacion === 'AGENTE' ? 'Agente oficial' : incidente.evaluacion}
            </span>
          )}
          {incidente.totalReportes > 1 && (
            <span className="badge">
              {incidente.totalReportes} reportes agrupados
            </span>
          )}
        </div>

        {/* Tabs switcher */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--line)',
            marginBottom: 14,
          }}
        >
          <button
            type="button"
            className="btn btn-quiet"
            style={{
              flex: 1,
              borderRadius: 0,
              borderBottom: activeTab === 'info' ? '2px solid var(--brand)' : 'none',
              color: activeTab === 'info' ? 'var(--brand)' : 'var(--muted)',
              fontWeight: activeTab === 'info' ? 700 : 500,
            }}
            onClick={() => setActiveTab('info')}
          >
            Información
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            style={{
              flex: 1,
              borderRadius: 0,
              borderBottom: activeTab === 'chat' ? '2px solid var(--brand)' : 'none',
              color: activeTab === 'chat' ? 'var(--brand)' : 'var(--muted)',
              fontWeight: activeTab === 'chat' ? 700 : 500,
            }}
            onClick={() => setActiveTab('chat')}
          >
            Comentarios ({comments.length})
          </button>
        </div>

        {error && <div className="notice notice-error">{error}</div>}
        {message && <div className="notice notice-success">{message}</div>}

        {/* Content body */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
          {activeTab === 'info' ? (
            <>
              {!incidente.adjuntos?.some(item=>item.mimeType?.startsWith('image/')&&!item.privado)&&<figure className="incident-type-illustration"><img src={getIncidentIconPath(incidente.tipoSlug,incidente.tipoNombre,incidente.tipo)} width={105} height={105} alt={incidente.tipoNombre||incidente.tipo}/><figcaption>Ilustración del tipo de incidente{incidente.individual?' · Pruebas privadas':''}</figcaption></figure>}
              {incidente.descripcion ? (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 13, marginBottom: 6 }}>Descripción del hecho</h4>
                  <p style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.6 }}>
                    {incidente.descripcion}
                  </p>
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 12, fontStyle: 'italic', marginBottom: 14 }}>
                  No se incluyó una descripción adicional en el reporte inicial.
                </p>
              )}

              {/* Attachments */}
              {incidente.adjuntos && incidente.adjuntos.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h4 style={{ fontSize: 13, marginBottom: 8 }}>Evidencias fotográficas</h4>
                  <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
                    {incidente.adjuntos.map((adj) => (
                      <div
                        key={adj.id}
                        style={{
                          width: 100,
                          height: 100,
                          borderRadius: 8,
                          overflow: 'hidden',
                          border: '1px solid var(--line)',
                          flexShrink: 0,
                          backgroundColor: 'var(--surface-muted)',
                        }}
                      >
                        {resolveMediaUrl(adj.url) ? (
                          <AuthenticatedMedia
                            url={adj.url!}
                            mimeType={adj.mimeType}
                            privado={adj.privado}
                            controls
                            alt="Evidencia"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ImageIcon size={24} color="var(--muted)" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Community Actions */}
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-full"
                  disabled={busyConfirm || busyResolve || !!incidente.individual || !['ACTIVO', 'VALIDADO', 'PENDIENTE'].includes(incidente.estado)}
                  onClick={handleConfirm}
                >
                  <CheckCircle size={18} />
                  <span>{busyConfirm ? 'Confirmando con GPS…' : 'Confirmar que sigue presente'}</span>
                </button>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ flex: 1, fontSize: 12, padding: '8px 10px' }}
                    disabled={busyResolve || busyConfirm || !!incidente.individual || !['ACTIVO', 'VALIDADO', 'PENDIENTE'].includes(incidente.estado)}
                    onClick={handleResolve}
                  >
                    <CheckCheck size={16} />
                    <span>{busyResolve ? 'Resolviendo…' : 'Marcar resuelto'}</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-quiet"
                    style={{ flex: 1, fontSize: 12, padding: '8px 10px', color: 'var(--muted)' }}
                    onClick={() => setShowFlagModal(!showFlagModal)}
                  >
                    <Flag size={15} />
                    <span>Señalar aviso</span>
                  </button>
                </div>

                {showFlagModal && (
                  <form
                    onSubmit={handleSendFlag}
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      backgroundColor: 'var(--surface-subtle)',
                      border: '1px solid var(--line)',
                      marginTop: 6,
                    }}
                  >
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                      Motivo del aviso
                    </label>
                    <select
                      className="form-input"
                      value={flagType}
                      onChange={(e) => setFlagType(e.target.value as any)}
                      style={{ width: '100%', marginBottom: 8, fontSize: 12, padding: '6px 8px' }}
                    >
                      <option value="NO_ENCONTRADO">No encontrado en el lugar</option>
                      <option value="FALSO">Incidente falso o malicioso</option>
                      <option value="REAPERTURA">Solicitar reapertura</option>
                    </select>
                    <textarea
                      className="form-input"
                      placeholder="Explica detalladamente la situación observada..."
                      value={flagReason}
                      onChange={(e) => setFlagReason(e.target.value)}
                      rows={2}
                      maxLength={500}
                      minLength={5}
                      required
                      style={{ width: '100%', fontSize: 12, marginBottom: 8 }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button
                        type="button"
                        className="btn btn-quiet btn-small"
                        onClick={() => setShowFlagModal(false)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary btn-small"
                        disabled={busyFlag || flagReason.trim().length < 5}
                      >
                        {busyFlag ? 'Enviando…' : 'Enviar aviso'}
                      </button>
                    </div>
                  </form>
                )}

                <small className="muted" style={{ display: 'block', textAlign: 'center', marginTop: 4 }}>
                  Tus confirmaciones con GPS ayudan a la comunidad a validar incidentes activos en Ica.
                </small>
              </div>
            </>
          ) : (
            /* Comments / Community Chat */
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, minHeight: 140, maxHeight: 220, overflowY: 'auto', marginBottom: 10 }}>
                {!usuario ? <p className="muted">Inicia sesión para consultar el chat del incidente.</p>
                  : chatLoading ? <p className="muted">Cargando comentarios…</p>
                  : chatError ? <div className="notice notice-error">{chatError}</div>
                  : comments.length === 0 ? (
                  <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 30 }}>
                    Aún no hay comentarios. Sé el primero en aportar detalles.
                  </p>
                ) : (
                  comments.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 10,
                        backgroundColor: 'var(--surface-subtle)',
                        border: '1px solid var(--line)',
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <strong style={{ fontSize: 11, color: 'var(--brand)' }}>
                          {c.usuario?.nickname || c.nickname || 'Ciudadano'}
                        </strong>
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                          {formatDate(c.creadoEn)}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 13 }}>{c.mensaje}</p>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleSendComment} style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Escribe un comentario o actualización…"
                  className="form-input"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  maxLength={500}
                  disabled={busyComment || !usuario || incidente.chatAbierto === false}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busyComment || !commentText.trim() || !usuario || !usuario.correoVerificado || !!usuario.bloqueado || incidente.chatAbierto === false}
                  style={{ minWidth: 44, padding: '0 14px' }}
                >
                  <Send size={16} />
                </button>
              </form>
              {incidente.chatAbierto === false && <small className="muted">El chat de este incidente está cerrado.</small>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
