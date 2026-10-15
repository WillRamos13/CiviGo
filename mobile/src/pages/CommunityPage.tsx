import React, { useState, useEffect, useRef } from 'react';
import { errorMessage } from '../services/api';
import { CommunityService, canRedeemReward, type RewardsResponse } from '../services/community';
import { useAuth } from '../hooks/useAuth';
import { useOperationScope } from '../hooks/useOperationScope';
import { triggerHaptic } from '../services/native';
import { Trophy, Gift, Coins, Check, RefreshCw, Medal } from 'lucide-react';
import type { RankingEntry, RewardItem } from '../types';

export const CommunityPage: React.FC = () => {
  const { usuario, refresh } = useAuth();
  const operations = useOperationScope(String(usuario?.id ?? 'guest'));
  const [tab, setTab] = useState<'ranking' | 'rewards'>('ranking');
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [rewards, setRewards] = useState<RewardItem[]>([]);
  const [rewardCatalog, setRewardCatalog] = useState<RewardsResponse | null>(null);
  const [rankingMonth, setRankingMonth] = useState('');
  const [rankingFinal, setRankingFinal] = useState(false);
  const [rankingError, setRankingError] = useState('');
  const [rewardsError, setRewardsError] = useState('');
  const requestId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [busyRedeem, setBusyRedeem] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadData = async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError('');
    setRankingError('');
    setRewardsError('');
    try {
      const [rankingData, rewardsData] = await Promise.allSettled([
        CommunityService.getRanking(),
        usuario ? CommunityService.getRewards() : Promise.resolve(null),
      ]);
      if (request !== requestId.current) return;

      if (rankingData.status === 'fulfilled') {
        setRanking(rankingData.value.entries);
        setRankingMonth(rankingData.value.mes);
        setRankingFinal(rankingData.value.finalized);
      } else {
        setRanking([]);
        setRankingError(errorMessage(rankingData.reason));
      }

      if (rewardsData.status === 'fulfilled') {
        setRewardCatalog(rewardsData.value);
        setRewards(rewardsData.value?.recompensas ?? []);
      } else {
        setRewardCatalog(null);
        setRewards([]);
        setRewardsError(errorMessage(rewardsData.reason));
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    setBusyRedeem(null);
    setMessage('');
    setRewards([]);
    setRewardCatalog(null);
    void loadData();
    return () => { ++requestId.current; };
  }, [usuario?.id]);

  const handleRedeem = async (reward: RewardItem) => {
    if (!usuario || busyRedeem !== null) return;
    if (!canRedeemReward(reward, rewardCatalog, usuario.correoVerificado && !usuario.bloqueado)) {
      setError('El canje de demostración requiere correo verificado, monedas y stock disponibles.');
      return;
    }
    const operation = operations.begin();
    void triggerHaptic('medium');
    setBusyRedeem(reward.id);
    setError('');
    setMessage('');

    try {
      operation.assertActive();
      const redemption = await CommunityService.redeem(reward, rewardCatalog, usuario.correoVerificado && !usuario.bloqueado, { signal: operation.signal });
      operation.assertActive();
      setMessage(`Canje de demostración de «${reward.nombre}» solicitado. Estado: ${redemption.estado}.`);
      await refresh().catch(() => {});
      operation.assertActive();
      await loadData();
    } catch (err) {
      if (operation.isActive()) setError(errorMessage(err));
    } finally {
      if (operation.isActive()) setBusyRedeem(null);
      operation.finish();
    }
  };

  return (
    <div className="page" style={{ paddingBottom: 'calc(40px + var(--safe-bottom))' }}>
      <div className="page-heading">
        <span className="eyebrow">COMUNIDAD CIVIGO</span>
        <h1>Ranking y Recompensas</h1>
        <p className="muted">Consulta los puntos del mes y los canjes de demostración por tus aportes en Ica.</p>
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
      {tab === 'ranking' && rankingError && <div className="notice notice-error">{rankingError}</div>}
      {tab === 'rewards' && rewardsError && <div className="notice notice-error">{rewardsError}</div>}
      {message && <div className="notice notice-success">{message}</div>}

      {tab === 'ranking' ? (
        <div>
          <div className="card-header" style={{ marginBottom: 12 }}>
            <span className="badge">{rankingMonth || 'Ranking mensual'} · {rankingFinal ? 'Finalizado' : 'Provisional'}</span>
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
          ) : rankingError ? null : ranking.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
              <p className="muted">Aún no hay puntuaciones registradas en este período.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ranking.map((entry) => {
                const isTop3 = entry.position <= 3;
                const medalColors = ['#eab308', '#94a3b8', '#b45309'];

                return (
                  <div
                    key={entry.nickname}
                    className="card"
                    style={{
                      padding: '12px 14px',
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        backgroundColor: isTop3 ? medalColors[entry.position - 1] : 'var(--surface-muted)',
                        color: isTop3 ? '#fff' : 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: 12,
                        flexShrink: 0,
                      }}
                    >
                      {entry.position}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 13, display: 'block' }}>
                        {entry.nickname}
                      </strong>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {entry.credibilidad === null ? 'Credibilidad sin evaluar' : `Credibilidad ${entry.credibilidad}%`}
                      </span>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ fontSize: 14, color: 'var(--brand)' }}>
                        {entry.puntos.toLocaleString('es-PE')}
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
                  {rewardCatalog ? `${rewardCatalog.monedas.toLocaleString('es-PE')} monedas` : 'Saldo sin consultar'}
                </h2>
              </div>
            </div>
          </div>

          {!usuario && <div className="notice">Inicia sesión para consultar tus monedas y recompensas.</div>}
          {rewardCatalog?.demo && <div className="notice">Catálogo de demostración. Los canjes no entregan premios reales.</div>}
          {loading ? (
            <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
              <p className="muted">Cargando catálogo de recompensas…</p>
            </div>
          ) : rewardsError || !usuario ? null : rewards.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
              <Gift size={32} color="var(--brand)" style={{ margin: '0 auto 10px' }} />
              <p className="muted" style={{ fontSize: 13 }}>
                Próximamente habrá más premios y reconocimientos disponibles para canje.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rewards.map((rew) => {
                const available = canRedeemReward(rew, rewardCatalog, !!usuario?.correoVerificado && !usuario?.bloqueado);

                return (
                  <div key={rew.id} className="card" style={{ padding: 14, margin: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div>
                        <strong style={{ fontSize: 14 }}>{rew.nombre}</strong>
                        <p className="muted" style={{ fontSize: 12, margin: '4px 0 8px' }}>
                          {rew.descripcion}
                        </p>
                        <small className="muted">Stock: {rew.stock}</small>
                      </div>
                      <span className="badge" style={{ backgroundColor: 'var(--surface-subtle)', color: 'var(--brand)' }}>
                        <Coins size={12} style={{ display: 'inline', marginRight: 4 }} />
                        {rew.costoMonedas}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="btn btn-primary btn-small btn-full"
                      disabled={!available || busyRedeem !== null}
                      onClick={() => handleRedeem(rew)}
                    >
                      {busyRedeem === rew.id
                        ? 'Procesando…'
                        : !usuario?.correoVerificado ? 'Verifica tu correo para canjear'
                        : rew.stock <= 0 ? 'Sin stock'
                        : available ? 'Solicitar canje de demostración'
                        : 'Canje no disponible'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {!!rewardCatalog?.canjes.length && <div className="card" style={{ marginTop: 14 }}>
            <h3>Tus canjes</h3>
            {rewardCatalog.canjes.map((redemption) => <p key={redemption.id} className="muted" style={{ fontSize: 12 }}>
              Canje #{redemption.id} · {redemption.costoMonedas} monedas · {redemption.estado}
            </p>)}
          </div>}
        </div>
      )}
    </div>
  );
};
