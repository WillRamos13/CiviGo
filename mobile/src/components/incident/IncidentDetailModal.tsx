import React, { useState, useEffect } from 'react';
import { X, CheckCircle, MessageSquare, Send, Shield, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { IncidentIcon } from '../map/IncidentIcon';
import { api, post, formatDate, errorMessage } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { triggerHaptic } from '../../services/native';
import { RISK_COLORS, RISK_NAMES } from '../../types';
import type { Incidente, Mensaje } from '../../types';

interface IncidentDetailModalProps {
  incidente: Incidente;
  onClose: () => void;
  onRefresh?: () => void;
}

export const IncidentDetailModal: React.FC<IncidentDetailModalProps> = ({
  incidente,
  onClose,
  onRefresh,
}) => {
  const { usuario } = useAuth();
  const [comments, setComments] = useState<Mensaje[]>([]);
  const [commentText, setCommentText] = useState('');
  const [busyConfirm, setBusyConfirm] = useState(false);
  const [busyComment, setBusyComment] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'info' | 'chat'>('info');

  const riskLevel = incidente.gravedad ?? incidente.nivelRiesgo ?? 0;
  const riskIndex = Math.min(Math.max(riskLevel, 0), RISK_COLORS.length - 1);
  const riskColor = RISK_COLORS[riskIndex];
  const riskName = RISK_NAMES[riskIndex];

  // Load comments
  useEffect(() => {
    let active = true;
    api<Mensaje[]>(`/incidents/${incidente.id}/comments`)
      .then((data) => {
        if (active) setComments(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [incidente.id]);

  const handleConfirm = async () => {
    if (!usuario) {
      setError('Inicia sesión para confirmar este incidente.');
      return;
    }
    void triggerHaptic('medium');
    setBusyConfirm(true);
    setError('');
    setMessage('');
    try {
      await post(`/incidents/${incidente.id}/confirm`);
      setMessage('¡Confirmación registrada con éxito!');
      onRefresh?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyConfirm(false);
    }
  };

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    if (!usuario) {
      setError('Inicia sesión para comentar.');
      return;
    }
    void triggerHaptic('light');
    setBusyComment(true);
    setError('');
    try {
      const res = await post<Mensaje>(`/incidents/${incidente.id}/comments`, {
        mensaje: commentText.trim(),
      });
      setComments((prev) => [...prev, res]);
      setCommentText('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyComment(false);
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
              Evaluación: {incidente.evaluacion === 'IA' ? 'Asistida por IA' : 'Agente oficial'}
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
                        {adj.url ? (
                          <img
                            src={adj.url}
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

              {/* Confirmation Action */}
              <div style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-full"
                  disabled={busyConfirm}
                  onClick={handleConfirm}
                >
                  <CheckCircle size={18} />
                  <span>{busyConfirm ? 'Confirmando…' : 'Confirmar que sigue presente'}</span>
                </button>
                <small className="muted" style={{ display: 'block', textAlign: 'center', marginTop: 8 }}>
                  Tus confirmaciones ayudan a la comunidad a validar incidentes activos en Ica.
                </small>
              </div>
            </>
          ) : (
            /* Comments / Community Chat */
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, minHeight: 140, maxHeight: 220, overflowY: 'auto', marginBottom: 10 }}>
                {comments.length === 0 ? (
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
                  disabled={busyComment}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busyComment || !commentText.trim()}
                  style={{ minWidth: 44, padding: '0 14px' }}
                >
                  <Send size={16} />
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
