import type { Mensaje } from '../types';

/** Earlier batches win duplicates: snapshots can replace a prior send acknowledgment. */
export function mergeIncidentMessages(...batches: readonly (readonly Mensaje[])[]): Mensaje[] {
  const messages = new Map<number, Mensaje>();
  for (const batch of batches) {
    for (const message of batch) if (!messages.has(message.id)) messages.set(message.id, message);
  }
  return [...messages.values()].sort((a, b) => {
    const left = Date.parse(a.creadoEn);
    const right = Date.parse(b.creadoEn);
    return (Number.isFinite(left) && Number.isFinite(right) ? left - right : 0) || a.id - b.id;
  });
}
