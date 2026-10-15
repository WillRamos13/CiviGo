import React, { useState, useEffect, useCallback } from 'react';
import { AuthGate } from '../components/layout/AuthGate';
import { useAuth } from '../hooks/useAuth';
import { api, put, formatDate, errorMessage } from '../services/api';
import { triggerHaptic } from '../services/native';
import { Bell, Check, RefreshCw } from 'lucide-react';
import type { NotificationItem } from '../types';

interface AlertsPageProps {
  onGoLogin: () => void;
  onGoRegister: () => void;
  onSelectIncidentId?: (id: number) => void;
}

export const AlertsPage: React.FC<AlertsPageProps> = ({
  onGoLogin,
  onGoRegister,
  onSelectIncidentId,
}) => {
  const { usuario } = useAuth();
  const requestId = React.useRef(0);
  const [alerts, setAlerts] = useState<NotificationItem[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAlerts = useCallback(async () => {
    const request = ++requestId.current;
    if (!usuario) { setAlerts([]); setLoading(false); setError(''); return; }
    setLoading(true);
    setError('');
    try {
      const data = await api<NotificationItem[]>('/notifications');
      if (request === requestId.current) setAlerts(data || []);
    } catch (err) {
      if (request === requestId.current) setError(errorMessage(err));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [usuario?.id]);

  useEffect(() => {
    setAlerts([]);
    void loadAlerts();
    return () => { ++requestId.current; };
  }, [loadAlerts]);

  const handleMarkAsRead = async (id: number) => {
    const request = requestId.current;
    setError('');
    void triggerHaptic('light');
    try {
      await put(`/notifications/${id}/read`);
      if (request !== requestId.current) return;
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, leida: true } : a))
      );
    } catch (err) {
      if (request === requestId.current) setError(errorMessage(err));
    }
  };

  const filteredAlerts = alerts.filter((a) => !unreadOnly || !a.leida);

  return (
    <div className="page" style={{ paddingBottom: 'calc(40px + var(--safe-bottom))' }}>
      <div className="page-heading">
        <span className="eyebrow">AVISOS Y NOVEDADES</span>
        <h1>Alertas ciudadanas</h1>
        <p className="muted">Novedades de la comunidad y estado de revisiones en tu cuenta.</p>
      </div>

      <AuthGate onGoLogin={onGoLogin} onGoRegister={onGoRegister}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <label className="inline-checkbox" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
            />
            <span style={{ fontSize: 12 }}>Solo no leídas</span>
          </label>

          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={loadAlerts}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'pulse' : ''} />
            <span>Actualizar</span>
          </button>
        </div>

        {error && <div className="notice notice-error">{error}</div>}

        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
            <p className="muted">Cargando avisos…</p>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '36px 16px' }}>
            <Bell size={36} color="var(--brand)" style={{ margin: '0 auto 12px' }} />
            <h2>Todo al día</h2>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              No tienes alertas pendientes de lectura en este momento.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredAlerts.map((a) => (
              <article
                key={a.id}
                className="card"
                style={{
                  padding: '14px',
                  margin: 0,
                  borderLeft: a.leida ? '1px solid var(--line)' : '3px solid var(--brand)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <strong style={{ fontSize: 14 }}>{a.titulo}</strong>
                  <span
                    className="badge"
                    style={{
                      backgroundColor: a.leida ? 'var(--surface-muted)' : 'var(--brand-soft)',
                      color: a.leida ? 'var(--muted)' : 'var(--badge-ink)',
                      fontSize: 10,
                    }}
                  >
                    {a.leida ? 'Leída' : 'Nueva'}
                  </span>
                </div>

                <p style={{ fontSize: 13, margin: '4px 0 10px', lineHeight: 1.5 }}>
                  {a.mensaje}
                </p>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <small className="muted">{formatDate(a.creadoEn)}</small>

                  <div style={{ display: 'flex', gap: 8 }}>
                    {a.incidenteId && onSelectIncidentId && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => onSelectIncidentId(a.incidenteId!)}
                      >
                        Ver incidente
                      </button>
                    )}

                    {!a.leida && (
                      <button
                        type="button"
                        className="btn btn-quiet btn-small"
                        onClick={() => handleMarkAsRead(a.id)}
                      >
                        <Check size={14} />
                        <span>Marcar leída</span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </AuthGate>
    </div>
  );
};
