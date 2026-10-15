import { api, post } from './api';
import type { RankingEntry, RewardItem } from '../types';

export interface RankingResponse {
  mes: string;
  entries: RankingEntry[];
  finalized: boolean;
  demo: boolean;
}

export interface Redemption {
  id: number;
  recompensaId: number;
  costoMonedas: number;
  estado: string;
  creadoEn: string;
}

export interface RewardsResponse {
  monedas: number;
  recompensas: RewardItem[];
  canjes: Redemption[];
  demo: boolean;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';

export function normalizeRanking(value: unknown): RankingResponse {
  if (!object(value) || typeof value.mes !== 'string' || !Array.isArray(value.entries)
    || typeof value.finalized !== 'boolean' || typeof value.demo !== 'boolean'
    || !value.entries.every((entry) => object(entry)
      && Number.isInteger(entry.position) && Number(entry.position) > 0
      && typeof entry.nickname === 'string' && finite(entry.puntos)
      && (entry.credibilidad === null || finite(entry.credibilidad))
      && finite(entry.monedasEstimadas))) {
    throw new Error('La respuesta del ranking no es válida.');
  }
  // Public ranking intentionally omits user IDs; preserve server positions, including ties.
  return value as unknown as RankingResponse;
}

export function normalizeRewards(value: unknown): RewardsResponse {
  if (!object(value) || !finite(value.monedas) || typeof value.demo !== 'boolean'
    || !Array.isArray(value.recompensas) || !Array.isArray(value.canjes)
    || !value.recompensas.every((reward) => object(reward)
      && Number.isInteger(reward.id) && Number(reward.id) > 0
      && typeof reward.nombre === 'string' && typeof reward.descripcion === 'string'
      && finite(reward.costoMonedas) && reward.costoMonedas >= 0
      && Number.isInteger(reward.stock) && Number(reward.stock) >= 0
      && typeof reward.activo === 'boolean' && typeof reward.demo === 'boolean')
    || !value.canjes.every((redemption) => object(redemption)
      && Number.isInteger(redemption.id) && Number.isInteger(redemption.recompensaId)
      && typeof redemption.estado === 'string' && typeof redemption.creadoEn === 'string'
      && finite(redemption.costoMonedas))) {
    throw new Error('La respuesta de recompensas no es válida.');
  }
  return value as unknown as RewardsResponse;
}

export function canRedeemReward(reward: RewardItem, catalog: RewardsResponse | null, verified: boolean): boolean {
  return verified && catalog?.demo === true && reward.demo === true && reward.activo
    && reward.stock > 0 && catalog.monedas >= reward.costoMonedas;
}

export const CommunityService = {
  async getRanking(): Promise<RankingResponse> {
    return normalizeRanking(await api<unknown>('/ranking'));
  },
  async getRewards(): Promise<RewardsResponse> {
    return normalizeRewards(await api<unknown>('/recompensas'));
  },
  async redeem(reward: RewardItem, catalog: RewardsResponse | null, verified: boolean, options: { signal?: AbortSignal } = {}): Promise<Redemption> {
    if (!canRedeemReward(reward, catalog, verified)) {
      throw new Error('El canje de demostración requiere correo verificado, monedas y stock disponibles.');
    }
    return post<Redemption>(`/recompensas/${reward.id}/canjear`, {}, options);
  },
};
