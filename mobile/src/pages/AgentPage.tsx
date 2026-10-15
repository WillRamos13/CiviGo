import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useOperationScope } from '../hooks/useOperationScope';
import { AgentService, hasAgentPermission, type IncidentReviewSummary, type ReviewActionPayload, type AgentMessage } from '../services/agent';
import { IncidentIcon } from '../components/map/IncidentIcon';
import { AuthenticatedMedia } from '../components/incident/AuthenticatedMedia';
import { api, formatDate, errorMessage } from '../services/api';
import { triggerHaptic } from '../services/native';
import { resolveMediaUrl } from '../services/media';
import { Shield, Check, X, AlertTriangle, RefreshCw, FileText, ChevronRight, Lock, Unlock } from 'lucide-react';
import { RISK_COLORS, RISK_NAMES } from '../types';
import type { Catalogo } from '../types';

type OperationalAction = ReviewActionPayload['accion'] | 'RECLASIFICAR' | 'REVISAR_AVISO' | 'RETIRAR_MENSAJE' | 'RESTAURAR_MENSAJE' | 'VALIDAR_APORTE' | 'FALSO_APORTE';
const ACTION_NAMES: Record<OperationalAction, string> = {
  VALIDAR: 'Validar incidente', GRAVEDAD: 'Ajustar gravedad', FALSO: 'Declarar incidente falso', RESOLVER: 'Resolver incidente',
  REABRIR: 'Reabrir incidente', RECLASIFICAR: 'Reclasificar incidente', REVISAR_AVISO: 'Atender aviso',
  RETIRAR_MENSAJE: 'Retirar mensaje', RESTAURAR_MENSAJE: 'Restaurar mensaje', VALIDAR_APORTE: 'Validar aporte', FALSO_APORTE: 'Declarar aporte falso',
};

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
  const canFlags = hasAgentPermission(usuario, 'avisos');
  const canModerate = hasAgentPermission(usuario, 'moderar');

  const [incidents, setIncidents] = useState<IncidentReviewSummary[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<IncidentReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [activeEvidence, setActiveEvidence] = useState<{ url: string; mimeType: string; privado?: boolean } | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [actionReason, setActionReason] = useState('');
  const [actionGravity, setActionGravity] = useState<number>(3);
  const [currentAction, setCurrentAction] = useState<OperationalAction | null>(null);
  const [actionTargetId, setActionTargetId] = useState<number | null>(null);
  const [actionTypeId, setActionTypeId] = useState(0);
  const [catalog, setCatalog] = useState<Catalogo | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const queueRequest = useRef(0);
  const queueController = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const operations = useOperationScope(`${usuario?.id ?? 'guest'}:${selectedIncident?.id ?? 'queue'}`);

  const beginAction = (action: OperationalAction, targetId: number | null = null) => {
    setCurrentAction(action);
    setActionTargetId(targetId);
    setActionReason('');
    setError('');
    setActionTypeId(0);
    const gravity = selectedIncident?.gravedad ?? selectedIncident?.nivelRiesgo;
    setActionGravity(typeof gravity === 'number' && gravity >= 1 && gravity <= 5 ? gravity : 3);
  };

  const handleSelectIncident = (inc: IncidentReviewSummary) => {
    void triggerHaptic('light');
    // The authorized admin queue already includes the complete reports and evidence.
    setSelectedIncident(inc);
    setCurrentAction(null);
    setActionReason('');
  };

  const loadIncidents = useCallback(async () => {
    const request = ++queueRequest.current;
    queueController.current?.abort();
    if (!canConsult) return;
    const controller = new AbortController();
    queueController.current = controller;
    setLoading(true);
    setError('');
    try {
      const res = await AgentService.getIncidents({
        distrito: usuario?.distrito || undefined,
        estado: statusFilter || undefined,
        pagina: page,
        busqueda: searchQuery,
      }, { signal: controller.signal });
      if (request !== queueRequest.current || controller.signal.aborted) return;
      setTotal(res.total);
      setPages(res.pages);
      if (page > res.pages) { setPage(res.pages); return; }
      setIncidents(res.items);
    } catch (err) {
      if (request === queueRequest.current) setError(errorMessage(err));
    } finally {
      if (request === queueRequest.current) setLoading(false);
    }
  }, [canConsult, usuario?.id, usuario?.distrito, statusFilter, page, searchQuery]);

  useEffect(() => {
    void loadIncidents();
    return () => { ++queueRequest.current; queueController.current?.abort(); };
  }, [loadIncidents]);

  useEffect(() => {
    setSelectedIncident(null);
    setActiveEvidence(null);
    setCurrentAction(null);
    setIncidents([]);
    setPage(1); setTotal(0); setPages(1);
    setError(''); setMessage('');
  }, [usuario?.id]);

  useEffect(() => {
    setBusyAction(false);
    setCurrentAction(null);
    setActionReason('');
    setMessagesError('');
  }, [usuario?.id, selectedIncident?.id]);

  useEffect(() => {
    if (!canClassify) return;
    let active = true;
    api<Catalogo>('/catalog').then((data) => { if (active) { setCatalog(data); setCatalogError(''); } })
      .catch((err) => { if (active) setCatalogError(errorMessage(err)); });
    return () => { active = false; };
  }, [canClassify]);

  useEffect(() => {
    setMessages([]);
    setMessagesError('');
    if (!selectedIncident || !canModerate) return;
    let active = true;
    setMessagesLoading(true);
    AgentService.getMessages(selectedIncident.id)
      .then((data) => { if (active) setMessages(data); })
      .catch((err) => { if (active) setMessagesError(errorMessage(err)); })
      .finally(() => { if (active) setMessagesLoading(false); });
    return () => { active = false; };
  }, [selectedIncident?.id, canModerate, usuario?.id]);

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
    if (!selectedIncident || !currentAction || actionReason.trim().length < 5 || busyAction) return;
    const operation = operations.begin();
    void triggerHaptic('heavy');
    setBusyAction(true);
    setError('');
    setMessage('');

    try {
      operation.assertActive();
      const motivo = actionReason.trim();
      const options = { signal: operation.signal };
      if (currentAction === 'RECLASIFICAR') {
        const type = catalog?.categorias.flatMap((category) => category.tipos).find((item) => item.id === actionTypeId);
        if (!type) throw new Error('Selecciona un tipo del catálogo.');
        await AgentService.classifyIncident(selectedIncident.id, { tipoId: type.id, motivo }, options);
      } else if (currentAction === 'REVISAR_AVISO') {
        if (!actionTargetId) return;
        await AgentService.reviewFlag(selectedIncident.id, actionTargetId, motivo, options);
      } else if (currentAction === 'RETIRAR_MENSAJE' || currentAction === 'RESTAURAR_MENSAJE') {
        if (!actionTargetId) return;
        await AgentService.moderateMessage(selectedIncident.id, actionTargetId, { accion: currentAction === 'RETIRAR_MENSAJE' ? 'RETIRAR' : 'RESTAURAR', motivo }, options);
      } else if (currentAction === 'VALIDAR_APORTE' || currentAction === 'FALSO_APORTE') {
        if (!actionTargetId) return;
        await AgentService.applyReportReview(actionTargetId, { accion: currentAction === 'VALIDAR_APORTE' ? 'VALIDAR' : 'FALSO', motivo,
          nivelRiesgo: currentAction === 'VALIDAR_APORTE' ? actionGravity : undefined }, options);
      } else {
        await AgentService.applyIncidentReview(selectedIncident.id, {
          accion: currentAction, motivo,
          nivelRiesgo: currentAction === 'GRAVEDAD' || currentAction === 'VALIDAR' ? actionGravity : undefined,
        }, options);
      }
      operation.assertActive();

      setMessage(`${ACTION_NAMES[currentAction]}: operación registrada en el incidente #${selectedIncident.id}.`);
      setCurrentAction(null);
      setActionReason('');
      setSelectedIncident(null);
      void loadIncidents();
    } catch (err) {
      if (operation.isActive()) setError(errorMessage(err));
    } finally {
      if (operation.isActive()) setBusyAction(false);
      operation.finish();
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

      {error && !selectedIncident && <div className="notice notice-error">{error}</div>}
      {message && <div className="notice notice-success">{message}</div>}

      {/* Search and Filter bar */}
      <div style={{ marginBottom: 12 }}>
        <input
          type="text"
          className="form-input"
          placeholder="Buscar por ID, tipo o descripción en Ica..."
          aria-label="Buscar incidentes"
          maxLength={160}
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, marginBottom: 8 }}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
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

      {!loading && !error && <p className="muted" role="status" style={{ fontSize: 12 }}>
        {total} {total === 1 ? 'incidente encontrado' : 'incidentes encontrados'}
      </p>}

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
          <p className="muted">Cargando cola de incidentes…</p>
        </div>
      ) : error ? null : incidents.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
          <Check size={32} color="var(--success-ink)" style={{ margin: '0 auto 10px' }} />
          <h3>{searchQuery.trim() ? 'Sin coincidencias' : 'Cola al día'}</h3>
          <p className="muted" style={{ fontSize: 12 }}>
            No hay incidentes pendientes con los filtros seleccionados.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {incidents.map((inc) => {
              const riskLevel = inc.gravedad ?? inc.nivelRiesgo;
              const knownRisk = inc.evaluacion !== 'PENDIENTE' && typeof riskLevel === 'number'
                && Number.isInteger(riskLevel) && riskLevel >= 0 && riskLevel < RISK_COLORS.length;
              const riskColor = knownRisk ? RISK_COLORS[riskLevel!] : 'var(--muted)';

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
                        {knownRisk ? `Nivel ${riskLevel}` : 'Por evaluar'}
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

      {pages > 1 && <nav aria-label="Páginas de incidentes" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
        <button type="button" className="btn btn-secondary btn-small" disabled={loading || page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</button>
        <span className="muted" style={{ fontSize: 12 }}>Página {page} de {pages}</span>
        <button type="button" className="btn btn-secondary btn-small" disabled={loading || page >= pages}
          onClick={() => setPage((current) => Math.min(pages, current + 1))}>Siguiente</button>
      </nav>}

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

            {error && <div className="notice notice-error">{error}</div>}
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 13, lineHeight: 1.5, margin: '0 0 10px' }}>
                {selectedIncident.descripcion || 'Sin descripción.'}
              </p>

              {/* Citizen reports and evidence attachments */}
              {selectedIncident.reportes && selectedIncident.reportes.length > 0 ? (
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
                        {rep.adjuntos && rep.adjuntos.some((adj) => canEvidence || !adj.privado) && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                            {rep.adjuntos.filter((adj) => canEvidence || !adj.privado).map((adj) => (
                              <button
                                key={adj.id}
                                type="button"
                                onClick={() => {
                                  const url = resolveMediaUrl(adj.url);
                                  if (url) {
                                    void triggerHaptic('light');
                                    setActiveEvidence({ url, mimeType: adj.mimeType, privado: adj.privado });
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
                                {resolveMediaUrl(adj.url) && adj.mimeType.startsWith('image/') ? (
                                  <AuthenticatedMedia
                                    url={adj.url!}
                                    mimeType={adj.mimeType}
                                    privado={adj.privado}
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
                        <small className="muted">Estado: {rep.estado}</small>
                        {rep.evidenciaPrivada && !canEvidence && <p className="muted">Este aporte requiere permiso para revisar pruebas privadas.</p>}
                        {!['FALSO', 'RETIRADO'].includes(rep.estado)
                          && (canEvidence || (!selectedIncident.individual && !rep.evidenciaPrivada)) && <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          {canValidate && <button type="button" className="btn btn-secondary btn-small" disabled={busyAction}
                            onClick={() => beginAction('VALIDAR_APORTE', rep.id)}>Validar aporte #{rep.id}</button>}
                          {canFalsify && <button type="button" className="btn btn-quiet btn-small" disabled={busyAction}
                            onClick={() => beginAction('FALSO_APORTE', rep.id)}>Declarar aporte falso</button>}
                        </div>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {!!selectedIncident.flags?.length && <div className="card" style={{ padding: 12 }}>
              <h4>Avisos ciudadanos</h4>
              {selectedIncident.flags.map((flag) => <div key={flag.id} style={{ marginTop: 10 }}>
                <strong style={{ fontSize: 12 }}>Aviso #{flag.id} · {flag.tipo} · {flag.estado}</strong>
                <p className="muted" style={{ fontSize: 12 }}>{flag.motivo}</p>
                {canFlags && flag.estado === 'PENDIENTE' && <button type="button" className="btn btn-secondary btn-small"
                  disabled={busyAction} onClick={() => beginAction('REVISAR_AVISO', flag.id)}>Registrar revisión del aviso</button>}
              </div>)}
            </div>}

            {canModerate && <div className="card" style={{ padding: 12 }}>
              <h4>Moderación del chat</h4>
              {messagesLoading ? <p className="muted">Cargando mensajes…</p> : messagesError ? <div className="notice notice-error">{messagesError}</div>
                : messages.length === 0 ? <p className="muted">No hay mensajes en este incidente.</p>
                : messages.map((item) => <div key={item.id} style={{ marginTop: 10 }}>
                  <strong style={{ fontSize: 12 }}>#{item.id} · {item.usuario?.nickname || 'Ciudadano'} · {formatDate(item.creadoEn)}</strong>
                  <p style={{ fontSize: 12 }}>{item.mensaje}</p>
                  <button type="button" className="btn btn-secondary btn-small" disabled={busyAction}
                    onClick={() => beginAction(item.retirado ? 'RESTAURAR_MENSAJE' : 'RETIRAR_MENSAJE', item.id)}>
                    {item.retirado ? 'Restaurar mensaje' : 'Retirar mensaje'}
                  </button>
                </div>)}
            </div>}

            {/* Operative Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {canValidate && selectedIncident.estado !== 'FALSO' && (canEvidence || (!selectedIncident.individual && !selectedIncident.reportes?.some((rep) => rep.evidenciaPrivada))) && (
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  disabled={busyAction}
                  onClick={() => beginAction('VALIDAR')}
                >
                  <Check size={16} />
                  <span>Validar autenticidad del incidente</span>
                </button>
              )}

              {canGravity && selectedIncident.estado !== 'FALSO' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={busyAction}
                  onClick={() => beginAction('GRAVEDAD')}
                >
                  <AlertTriangle size={16} />
                  <span>Ajustar nivel de gravedad</span>
                </button>
              )}

              {canClassify && selectedIncident.estado !== 'FALSO' && (canEvidence || !selectedIncident.individual) && (
                <button type="button" className="btn btn-secondary btn-small" disabled={busyAction}
                  onClick={() => beginAction('RECLASIFICAR')}>Reclasificar tipo de incidente</button>
              )}

              {canResolve && !['RESUELTO', 'FALSO'].includes(selectedIncident.estado) && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={busyAction}
                  onClick={() => beginAction('RESOLVER')}
                >
                  <Lock size={16} />
                  <span>Marcar incidente como resuelto</span>
                </button>
              )}

              {canReopen && ['RESUELTO', 'RETIRADO'].includes(selectedIncident.estado) && (
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={busyAction}
                  onClick={() => beginAction('REABRIR')}
                >
                  <Unlock size={16} />
                  <span>Reabrir incidente activo</span>
                </button>
              )}

              {canFalsify && selectedIncident.estado !== 'FALSO' && (selectedIncident.reportes?.length ?? selectedIncident.totalReportes) <= 1
                && (canEvidence || (!selectedIncident.individual && !selectedIncident.reportes?.some((rep) => rep.evidenciaPrivada))) && (
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  disabled={busyAction}
                  onClick={() => beginAction('FALSO')}
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
                  {ACTION_NAMES[currentAction]}{actionTargetId ? ` #${actionTargetId}` : ''}
                </h4>

                {['GRAVEDAD', 'VALIDAR', 'VALIDAR_APORTE'].includes(currentAction) && (
                  <div className="field">
                    <label>Nivel de gravedad (1 - 5)</label>
                    <select
                      value={actionGravity}
                      onChange={(e) => setActionGravity(Number(e.target.value))}
                    >
                      {RISK_NAMES.slice(1).map((name, i) => (
                        <option key={i + 1} value={i + 1}>
                          Nivel {i + 1} - {name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {currentAction === 'RECLASIFICAR' && <div className="field">
                  <label htmlFor="agent-new-type">Nuevo tipo del catálogo</label>
                  {catalogError && <div className="notice notice-error">{catalogError}</div>}
                  {!catalog && !catalogError && <p className="muted">Cargando tipos…</p>}
                  <select id="agent-new-type" value={actionTypeId} required disabled={!catalog || busyAction}
                    onChange={(event) => setActionTypeId(Number(event.target.value))}>
                    <option value={0}>Selecciona el nuevo tipo</option>
                    {catalog?.categorias.map((category) => <optgroup key={category.id} label={category.nombre}>
                      {category.tipos.filter((type) => !type.individual || (canEvidence && (selectedIncident.reportes?.length ?? selectedIncident.totalReportes) <= 1))
                        .map((type) => <option key={type.id} value={type.id}>{type.nombre}</option>)}
                    </optgroup>)}
                  </select>
                  <small>Al clasificar como delito individual, las pruebas pasan a ser privadas y requieren una nueva revisión.</small>
                </div>}

                <div className="field">
                  <label>Motivo y justificación oficial (obligatorio)</label>
                  <textarea
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                    required
                    minLength={5}
                    maxLength={2000}
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
                    disabled={busyAction || actionReason.trim().length < 5 || (currentAction === 'RECLASIFICAR' && !actionTypeId)}
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
      {activeEvidence && (
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
          onClick={() => setActiveEvidence(null)}
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
            onClick={() => setActiveEvidence(null)}
            aria-label="Cerrar vista previa"
          >
            <X size={22} />
          </button>

          <AuthenticatedMedia
            url={activeEvidence.url}
            mimeType={activeEvidence.mimeType}
            privado={activeEvidence.privado}
            controls
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
