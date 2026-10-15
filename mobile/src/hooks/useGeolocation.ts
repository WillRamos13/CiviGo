import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentDevicePosition, watchDevicePosition } from '../services/native';
import type { LocationFix } from '../types';
import { isPosition } from '../services/navigation';
import { GeolocationAccessPolicy, normalizeGeolocationError, watchWithGeolocationConsent } from '../services/geolocation-consent';

export function useGeolocation(autoWatch = false) {
  const [position, setPosition] = useState<LocationFix | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const active = useRef(true);
  const requestId = useRef(0);
  const latestTimestamp = useRef(0);
  const accessPolicy = useRef(new GeolocationAccessPolicy());
  const stopWatching = useRef<(() => void) | null>(null);
  const [watchAttempt, setWatchAttempt] = useState(0);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; requestId.current += 1; };
  }, []);

  const acceptPosition = useCallback((fix: LocationFix) => {
    if (!active.current || !isPosition(fix)) return;
    const timestamp = fix.timestamp ?? Date.now();
    if (timestamp < latestTimestamp.current) return;
    latestTimestamp.current = timestamp;
    setPosition({ ...fix, timestamp });
    setError('');
  }, []);

  const locate = useCallback(async () => {
    const id = ++requestId.current;
    stopWatching.current?.();
    accessPolicy.current.beginManualAttempt();
    setLoading(true);
    setError('');
    try {
      const pos = await getCurrentDevicePosition();
      if (!active.current || id !== requestId.current) return null;
      if (!isPosition(pos)) throw new Error('El GPS devolvió coordenadas inválidas.');
      acceptPosition(pos);
      return pos;
    } catch (err) {
      if (active.current && id === requestId.current) {
        const failure = normalizeGeolocationError(err);
        accessPolicy.current.observeError(failure);
        setError(failure.message);
      }
      return null;
    } finally {
      if (active.current && id === requestId.current) {
        accessPolicy.current.finishManualAttempt();
        setLoading(false);
        setWatchAttempt((attempt) => attempt + 1);
      }
    }
  }, [acceptPosition]);

  useEffect(() => {
    if (!autoWatch || !accessPolicy.current.canWatchAutomatically()) return;
    let watching = true;
    const unsub = watchWithGeolocationConsent(accessPolicy.current, watchDevicePosition,
      (pos) => {
        if (watching) acceptPosition(pos);
      },
      (err) => {
        if (watching && active.current) setError(err.message);
      }
    );
    const stop = () => { watching = false; unsub(); };
    stopWatching.current = stop;
    return () => { stop(); if (stopWatching.current === stop) stopWatching.current = null; };
  }, [autoWatch, acceptPosition, watchAttempt]);

  return {
    position,
    loading,
    error,
    locate,
    setPosition,
  };
}
