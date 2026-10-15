import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { AgentService, hasAgentPermission, type IncidentReviewSummary, type ReviewActionPayload } from '../services/agent';
import { IncidentIcon } from '../components/map/IncidentIcon';
import { formatDate, errorMessage } from '../services/api';
import { triggerHaptic } from '../services/native';
import { Shield, Check, X, AlertTriangle, RefreshCw, FileText, ChevronRight, Lock, Unlock } from 'lucide-react';
import { RISK_COLORS, RISK_NAMES } from '../types';

interface AgentPageProps {
  onBack: () => void;
}

export const AgentPage: React.FC<AgentPageProps> = ({ onBack }) => {
  const { usuario } = useAuth();
  const canConsult = hasAgentPermission(usuario, 'consultar');
  const canValidate = hasAgentPermission(usuario, 'validar');
  const canGravity = hasAgentPermission(usuario, 'gravedad');
  const canClassify = hasAgentPermission(usuario, 'clasificar');
  const canFalsify = hasAgentPermission(usuario, 'falsedad');
  const canResolve = hasAgentPermission(usuario, 'resolver');
  const canReopen = hasAgentPermission(usuario, 'reabrir');
  const canEvidence = hasAgentPermission(usuario, 'evidencia');

  const [incidents, setIncidents] = useState<IncidentReviewSummary[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<IncidentReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeEvidenceUrl, setActiveEvidenceUrl] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [actionReason, setActionReason] = useState('');
  const [actionGravity, setActionGravity] = useState<number>(3);
  const [currentAction, setCurrentAction] = useState<ReviewActionPayload['accion'] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSelectIncident = async (inc: IncidentReviewSummary) => {
    void triggerHaptic('light');
    setSelectedIncident(inc);
    setDetailLoading(true);
    try {
      const detailed = await AgentService.getIncidentDetail(inc.id);
      setSelectedIncident(detailed);
    } catch {
      // Keep basic summary
    } finally {
      setDetailLoading(false);
    }
  };

  const loadIncidents = useCallback(async () => {
    if (!canConsult) return;
    setLoading(true);
    setError('');
    try {
      const res = await AgentService.getIncidents({
        distrito: usuario?.distrito || undefined,
        estado: statusFilter || undefined,
      });
      setIncidents(res.incidentes || []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [canConsult, usuario?.distrito, statusFilter]);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  if (!canConsult) {
    return (
      <div className="page">
        <div className="card" style={{ textAlign: 'center', padding: '36px 16px' }}>
          <Shield size={36} color="var(--error-ink)" style={{ margin: '0 auto 12px' }} />
          <h2>Acceso restringido a Agentes</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            Tu cuenta no cuenta con permisos operativos de Agente o tu distrito no ha sido asignado.
          </p>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  const handleApplyAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIncident || !currentAction || !actionReason.trim()) return;
    void triggerHaptic('heavy');
    setBusyAction(true);
    setError('');
    setMessage('');

    try {
      await AgentService.applyIncidentReview(selectedIncident.id, {
        accion: currentAction,
        motivo: actionReason.trim(),
        nivelRiesgo: currentAction === 'GRAVEDAD' ? actionGravity : undefined,
      });

      setMessage(`Acción ${currentAction} aplicada con éxito al incidente #${selectedIncident.id}.`);
      setCurrentAction(null);
      setActionReason('');
      setSelectedIncident(null);
      void loadIncidents();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="page" style={{ paddingBottom: 'calc(40px + var(--safe-bottom))' }}>
      <div className="page-heading">
        <span className="badge" style={{ backgroundColor: 'var(--brand-soft)', color: 'var(--brand)' }}>
          <Shield size={12} style={{ display: 'inline', marginRight: 4 }} />
          OPERACIONES CIVIGO
        </span>
        <h1 style={{ marginTop: 8 }}>Centro de revisión de Agente</h1>
        <p className="muted">
          Ámbito asignado: {usuario?.distrito || 'Provincia de Ica general'}
        </p>
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {message && <div className="notice notice-success">{message}</div>}

      {/* Search and Filter bar */}
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          className="form-input"
          placeholder="Buscar por ID, tipo o descripción en Ica..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, marginBottom: 8 }}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="form-input"
            style={{ flex: 1, padding: '8px 10px', fontSize: 12 }}
          >
            <option value="">Todos los estados</option>
            <option value="REVISION">En revisión / evaluación</option>
            <option value="ACTIVO">Activos comunitarios</option>
            <option value="PUBLICADOS">Publicados en mapa</option>
            <option value="VALIDADO">Validados</option>
            <option value="RESUELTO">Resueltos</option>
            <option value="FALSO">Descartados / Falsos</option>
            <option value="SIN_PUBLICAR">Sin publicar</option>
          </select>

          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={loadIncidents}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'pulse' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
          <p className="muted">Cargando cola de incidentes…</p>
        </div>
      ) : incidents.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
          <Check size={32} color="var(--success-ink)" style={{ margin: '0 auto 10px' }} />
          <h3>Cola al día</h3>
          <p className="muted" style={{ fontSize: 12 }}>
            No hay incidentes pendientes con los filtros seleccionados.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {incidents
            .filter((inc) => {
              if (!searchQuery.trim()) return true;
              const q = searchQuery.toLowerCase().trim();
              return (
                String(inc.id).includes(q) ||
                (inc.tipoNombre || inc.tipo).toLowerCase().includes(q) ||
                (inc.descripcion || '').toLowerCase().includes(q) ||
                (inc.distrito || '').toLowerCase().includes(q)
              );
            })
            .map((inc) => {
              const riskLevel = inc.gravedad ?? inc.nivelRiesgo ?? 0;
              const riskColor = RISK_COLORS[Math.min(riskLevel, RISK_COLORS.length - 1)];

              return (
                <div
                  key={inc.id}
                  className="card"
                  style={{ padding: 14, margin: 0, cursor: 'pointer' }}
                  onClick={() => handleSelectIncident(inc)}
                >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <IncidentIcon tipo={inc.tipoNombre || inc.tipo} size={36} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <strong style={{ fontSize: 14 }}>
                        #{inc.id} · {inc.tipoNombre || inc.tipo}
                      </strong>
                      <span
                        className="badge"
                        style={{ backgroundColor: riskColor, color: '#fff', fontSize: 10 }}
                      >
                        Nivel {riskLevel}
                      </span>
                    </div>

                    <p className="muted" style={{ fontSize: 12, margin: '4px 0 6px' }}>
                      {inc.descripcion || 'Sin descripción detallada.'}
                    </p>

                    <div style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--muted)' }}>
                      <span>{inc.distrito || 'Ica'}</span>
                      <span>·</span>
                      <span>{inc.totalReportes} reportes</span>
                      <span>·</span>
                      <span style={{ fontWeight: 600 }}>{inc.estado}</span>
                    </div>
                  </div>

                  <ChevronRight size={18} color="var(--muted)" style={{ alignSelf: 'center' }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Incident Review Modal Sheet */}
      {selectedIncident && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'var(--backdrop)',
            zIndex: 70,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
          onClick={() => {
            setSelectedIncident(null);
            setCurrentAction(null);
          }}
        >
          <div
            className="map-bottom-sheet"
            style={{ maxHeight: '85vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bottom-sheet-handle" />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <IncidentIcon tipo={selectedIncident.tipoNombre || selectedIncident.tipo} size={36} />
                <div>
                  <h3 style={{ margin: 0, fontSize: 16 }}>
                    Revisión: Incidente #{selectedIncident.id}
                  </h3>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {selectedIncident.distrito} · {formatDate(selectedIncident.fechaCreacion)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setSelectedIncident(null);
                  setCurrentAction(null);
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 13, lineHeight: 1.5, margin: '0 0 10px' }}>
                {selectedIncident.descripcion || 'Sin descripción.'}
              </p>

              {/* Citizen reports and evidence attachments */}
              {detailLoading ? (
                <div style={{ padding: '12px 0', textAlign: 'center' }}>
                  <p className="muted" style={{ fontSize: 12 }}>
                    Cargando expediente completo y evidencias…
                  </p>
                </div>
              ) : selectedIncident.reportes && selectedIncident.reportes.length > 0 ? (
                <div style={{ marginTop: 10, marginBottom: 14 }}>
                  <span className="eyebrow" style={{ fontSize: 10, marginBottom: 6, display: 'block' }}>
                    REPORTES CIUDADANOS ASOCIADOS ({selectedIncident.reportes.length})
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {selectedIncident.reportes.map((rep) => (
                      <div
                        key={rep.id}
                        style={{
                          padding: 10,
                          backgroundColor: 'var(--surface-subtle)',
                          borderRadius: 8,
                          border: '1px solid var(--line)',
                          fontSize: 12,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <strong>Reporte #{rep.id} · {rep.usuario?.nickname || 'Ciudadano'}</strong>
                          <span className="muted" style={{ fontSize: 11 }}>{formatDate(rep.fechaCreacion)}</span>
                        </div>
                        <p style={{ margin: '4px 0 6px', color: 'var(--ink)' }}>
                          {rep.descripcion || 'Sin texto descriptivo.'}
                        </p>

                        {/* Evidence Thumbnails */}
                        {canEvidence && rep.adjuntos && rep.adjuntos.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                            {rep.adjuntos.map((adj) => (
                              <button
                                key={adj.id}
                                type="button"
                                onClick={() => {
                                  if (adj.url) {
                                    void triggerHaptic('light');
                                    setActiveEvidenceUrl(adj.url);
                                  }
                                }}
                                style={{
                                  border: '1px solid var(--line)',
                                  borderRadius: 6,
                                  overflow: 'hidden',
                                  width: 52,
                                  height: 52,
                                  padding: 0,
                                  background: 'var(--surface)',
                                  position: 'relative',
                                  cursor: 'pointer',
                                }}
                              >
                                {adj.url ? (
                                  <img
                                    src={adj.url}
                                    alt="Evidencia"
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                  />
                                ) : (
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                    <FileText size={18} color="var(--brand)" />
                                  </div>
                                )}
                                {adj.privado && (
                                  <span
                                    style={{
                                      position: 'absolute',
                                      bottom: 2,
                                      right: 2,
                                      background: 'rgba(0,0,0,0.65)',
                                      borderRadius: '50%',
                                      padding: 2,
                                      color: '#fff',
                                      display: 'flex',
                                    }}
                                    title="Prueba privada"
                                  >
                                    <Lock size={10} />
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Operative Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {canValidate && (
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={() => setCurrentAction('VALIDAR')}
                >
                  <Check size={16} />
                  <span>Validar autenticidad del incidente</span>
                </button>
              )}

              {canGravity && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setCurrentAction('GRAVEDAD')}
                >
                  <AlertTriangle size={16} />
                  <span>Ajustar nivel de gravedad</span>
                </button>
              )}

              {canResolve && selectedIncident.estado !== 'RESUELTO' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setCurrentAction('RESOLVER')}
                >
                  <Lock size={16} />
                  <span>Marcar incidente como resuelto</span>
                </button>
              )}

              {canReopen && selectedIncident.estado === 'RESUELTO' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setCurrentAction('REABRIR')}
                >
                  <Unlock size={16} />
                  <span>Reabrir incidente activo</span>
                </button>
              )}

              {canFalsify && (
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  onClick={() => setCurrentAction('FALSO')}
                >
                  <X size={16} />
                  <span>Declarar falso / spam</span>
                </button>
              )}
            </div>

            {/* Subform for Action Motive */}
            {currentAction && (
              <form
                onSubmit={handleApplyAction}
                style={{
                  marginTop: 16,
                  padding: 12,
                  borderRadius: 10,
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--line)',
                }}
              >
                <h4 style={{ fontSize: 13, marginBottom: 8 }}>
                  Confirmar acción: {currentAction}
                </h4>

                {currentAction === 'GRAVEDAD' && (
                  <div className="field">
                    <label>Nuevo nivel de gravedad (0 - 5)</label>
                    <select
                      value={actionGravity}
                      onChange={(e) => setActionGravity(Number(e.target.value))}
                    >
                      {RISK_NAMES.map((name, i) => (
                        <option key={i} value={i}>
                          Nivel {i} - {name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="field">
                  <label>Motivo y justificación oficial (obligatorio)</label>
                  <textarea
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                    required
                    minLength={6}
                    maxLength={1000}
                    placeholder="Explica la causa técnica o inspección del hecho..."
                  />
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    style={{ flex: 1 }}
                    onClick={() => setCurrentAction(null)}
                    disabled={busyAction}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-small"
                    style={{ flex: 1 }}
                    disabled={busyAction || !actionReason.trim()}
                  >
                    {busyAction ? 'Procesando…' : 'Confirmar y aplicar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen Evidence Viewer Modal */}
      {activeEvidenceUrl && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.92)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setActiveEvidenceUrl(null)}
        >
          <button
            type="button"
            className="icon-btn"
            style={{
              position: 'absolute',
              top: 'calc(16px + var(--safe-top))',
              right: 16,
              color: '#fff',
              backgroundColor: 'rgba(255,255,255,0.15)',
            }}
            onClick={() => setActiveEvidenceUrl(null)}
            aria-label="Cerrar vista previa"
          >
            <X size={22} />
          </button>

          <img
            src={activeEvidenceUrl}
            alt="Evidencia en resolución completa"
            style={{
              maxWidth: '100%',
              maxHeight: '85vh',
              objectFit: 'contain',
              borderRadius: 8,
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
