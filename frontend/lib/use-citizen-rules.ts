'use client';
import { useCallback, useState } from 'react';
import { api } from './api';
import { citizenRules, type CitizenRules } from './citizen-rules';
import type { Catalogo } from './types';
import { useLiveRefresh } from './use-live-refresh';

export function useCitizenRules() {
  const [rules, setRules] = useState<CitizenRules | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    const catalog = await api<Catalogo>('/catalog', { signal });
    if (!signal.aborted) setRules(citizenRules(catalog.config));
  }, []);
  useLiveRefresh(load, 60000);
  return rules;
}
