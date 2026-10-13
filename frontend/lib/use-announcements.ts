'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { api } from './api';
import { announcementPath, visibleAnnouncements, type Announcement, type AnnouncementPlacement } from './announcements';
import { useLiveRefresh } from './use-live-refresh';

export function useAnnouncements(placement: AnnouncementPlacement) {
  const { usuario } = useAuth();
  const [items, setItems] = useState<Announcement[]>([]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const data = await api<Announcement[]>(announcementPath(placement), { signal });
      if (!signal.aborted) setItems(data);
    } catch { if (!signal.aborted) setItems([]); }
  }, [placement]);
  const refresh = useLiveRefresh(load, 60000);
  useEffect(() => { refresh(); }, [usuario?.id, usuario?.premium, usuario?.ocultarAnuncios, refresh]);
  const visible = visibleAnnouncements(items, placement, !!(usuario?.premium && usuario.ocultarAnuncios));
  useEffect(() => {
    if (visible.length < 2 || paused) return;
    const timer = setInterval(() => setIndex(value => value + 1), 10000);
    return () => clearInterval(timer);
  }, [visible.length, paused]);
  return {
    current: visible.length ? visible[index % visible.length] : null,
    count: visible.length,
    setPaused,
    previous: () => setIndex(value => (value - 1 + visible.length) % Math.max(1, visible.length)),
    next: () => setIndex(value => value + 1),
  };
}
