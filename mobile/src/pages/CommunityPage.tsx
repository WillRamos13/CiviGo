import React, { useState, useEffect } from 'react';
import { api, post, errorMessage } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { triggerHaptic } from '../services/native';
import { Trophy, Gift, Coins, Check, RefreshCw, Medal } from 'lucide-react';
import type { RankingEntry, RewardItem } from '../types';

export const CommunityPage: React.FC = () => {
  const { usuario, refresh } = useAuth();
  const [tab, setTab] = useState<'ranking' | 'rewards'>('ranking');
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyRedeem, setBusyRedeem] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [rankingData, rewardsData] = await Promise.allSettled([
        api<{ entries?: any[]; ranking?: any[] } | any[]>('/ranking'),
        api<{ recompensas?: RewardItem[]; canjes?: any[] } | RewardItem[]>('/recompensas'),
      ]);

      if (rankingData.status === 'fulfilled') {
        const val = rankingData.value;
        const rawList = Array.isArray(val)
          ? val
          : val && typeof val === 'object' && Array.isArray((val as any).entries)
          ? (val as any).entries
          : (val as any).ranking || [];

        const normalized: RankingEntry[] = rawList.map((item: any, idx: number) => ({
          posicion: item.position ?? item.posicion ?? idx + 1,
          id: item.id ?? item.usuarioId ?? idx + 1,
          nickname: item.nickname || 'Ciudadano Ica',
          puntosMensuales: item.puntos ?? item.puntosMensuales ?? 0,
          reportesValidados: item.reportesValidados ?? 0,
          insigniaPrincipal: item.credibilidad ? `Credibilidad ${item.credibilidad}%` : undefined,
        }));
        setRanking(normalized);
      }

      if (rewardsData.status === 'fulfilled') {
        const val = rewardsData.value;
        const list: RewardItem[] = Array.isArray(val)
          ? val
          : (val as any).recompensas || [];
        setRewards(list);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleRedeem = async (reward: RewardItem) => {
    if (!usuario) return;
    if ((usuario.monedas || 0) < reward.costoMonedas) {
      setError('No tienes suficientes monedas CiviGo para este canje.');
      return;
    }
    void triggerHaptic('medium');
    setBusyRedeem(reward.id);
    setError('');
    setMessage('');

    try {
      await post(`/recompensas/${reward.id}/canjear`);
      setMessage(`¡Canje de «${reward.titulo}» solicitado con éxito!`);
      await refresh();
      void loadData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyRedeem(null);
    }
  };

  return (
    <div className="page" style={{ paddingBottom: 'calc(40px + var(--safe-bottom))' }}>
      <div className="page-heading">
        <span className="eyebrow">COMUNIDAD CIVIGO</span>
        <h1>Ranking y Recompensas</h1>
        <p className="muted">Compite sanamente y canjea reconocimientos por tus aportes en Ica.</p>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          backgroundColor: 'var(--surface-subtle)',
          padding: 4,
          borderRadius: 12,
          marginBottom: 16,
          border: '1px solid var(--line)',
        }}
      >
        <button
          type="button"
          className="btn btn-quiet btn-small"
          style={{
            flex: 1,
            backgroundColor: tab === 'ranking' ? 'var(--surface)' : 'transparent',
            color: tab === 'ranking' ? 'var(--brand)' : 'var(--muted)',
            fontWeight: tab === 'ranking' ? 700 : 500,
            boxShadow: tab === 'ranking' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
          }}
          onClick={() => {
            void triggerHaptic('light');
            setTab('ranking');
          }}
        >
          <Trophy size={16} />
          <span>Ranking del mes</span>
        </button>

        <button
          type="button"
          className="btn btn-quiet btn-small"
          style={{
            flex: 1,
            backgroundColor: tab === 'rewards' ? 'var(--surface)' : 'transparent',
            color: tab === 'rewards' ? 'var(--brand)' : 'var(--muted)',
            fontWeight: tab === 'rewards' ? 700 : 500,
            boxShadow: tab === 'rewards' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
          }}
          onClick={() => {
            void triggerHaptic('light');
            setTab('rewards');
          }}
        >
          <Gift size={16} />
          <span>Recompensas</span>
        </button>
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {message && <div className="notice notice-success">{message}</div>}

      {tab === 'ranking' ? (
        <div>
          <div className="card-header" style={{ marginBottom: 12 }}>
            <span className="badge">Líderes de Ica</span>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={loadData}
              disabled={loading}
            >
              <RefreshCw size={13} className={loading ? 'pulse' : ''} />
              <span>Actualizar</span>
            </button>
          </div>

          {loading ? (
            <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
              <p className="muted">Cargando clasificación…</p>
            </div>
          ) : ranking.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
              <p className="muted">Aún no hay puntuaciones registradas en este período.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ranking.map((entry, idx) => {
                const isMe = usuario?.id === entry.id;
                const isTop3 = idx < 3;
                const medalColors = ['#eab308', '#94a3b8', '#b45309'];

                return (
                  <div
                    key={entry.id || idx}
                    className="card"
                    style={{
                      padding: '12px 14px',
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      borderColor: isMe ? 'var(--brand)' : 'var(--line)',
                      backgroundColor: isMe ? 'var(--brand-soft)' : 'var(--surface)',
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        backgroundColor: isTop3 ? medalColors[idx] : 'var(--surface-muted)',
                        color: isTop3 ? '#fff' : 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: 12,
                        flexShrink: 0,
                      }}
                    >
                      {idx + 1}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 13, display: 'block' }}>
                        {entry.nickname} {isMe && '(Tú)'}
                      </strong>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {entry.reportesValidados} reportes validados
                      </span>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ fontSize: 14, color: 'var(--brand)' }}>
                        {entry.puntosMensuales.toLocaleString('es-PE')}
                      </strong>
                      <span className="muted" style={{ fontSize: 10, display: 'block' }}>pts</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Rewards Tab */
        <div>
          {/* User Coins Summary */}
          <div
            className="card"
            style={{
              backgroundColor: 'var(--brand-soft)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Coins size={28} color="var(--brand)" />
              <div>
                <span className="eyebrow" style={{ fontSize: 10 }}>TUS FONDOS CIVIGO</span>
                <h2 style={{ fontSize: 20, margin: 0, color: 'var(--brand)' }}>
                  {Number(usuario?.monedas || 0).toLocaleString('es-PE')} monedas
                </h2>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
              <p className="muted">Cargando catálogo de recompensas…</p>
            </div>
          ) : rewards.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
              <Gift size={32} color="var(--brand)" style={{ margin: '0 auto 10px' }} />
              <p className="muted" style={{ fontSize: 13 }}>
                Próximamente habrá más premios y reconocimientos disponibles para canje.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rewards.map((rew) => {
                const canAfford = (usuario?.monedas || 0) >= rew.costoMonedas;

                return (
                  <div key={rew.id} className="card" style={{ padding: 14, margin: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div>
                        <strong style={{ fontSize: 14 }}>{rew.titulo}</strong>
                        <p className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>
                          {rew.descripcion}
                        </p>
                      </div>
                      <span className="badge" style={{ backgroundColor: 'var(--surface-subtle)', color: 'var(--brand)' }}>
                        <Coins size={12} style={{ display: 'inline', marginRight: 4 }} />
                        {rew.costoMonedas}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary btn-small btn-full"
                      disabled={!canAfford || busyRedeem === rew.id || rew.canjeado}
                      onClick={() => handleRedeem(rew)}
                    >
                      {rew.canjeado
                        ? 'Ya canjeado'
                        : busyRedeem === rew.id
                        ? 'Procesando…'
                        : canAfford
                        ? 'Canjear recompensa'
                        : 'Monedas insuficientes'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
