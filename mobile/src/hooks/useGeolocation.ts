import {gpsProblem} from '../services/gpsQuality';
import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentDevicePosition, watchDevicePosition } from '../services/native';
import type { LocationFix } from '../types';
import { isPosition } from '../services/navigation';
import { GeolocationAccessPolicy, isGeolocationDenial, normalizeGeolocationError, watchWithGeolocationConsent } from '../services/geolocation-consent';
import { useAppActivity } from './useAppActivity';
import { getAppActivity } from '../services/appLifecycle';

export function useGeolocation(autoWatch = false) {
  const foreground = useAppActivity();
  const [position, setPosition] = useState<LocationFix | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const active = useRef(true);
  const requestId = useRef(0);
  const latestTimestamp = useRef(0);
  const lastReliableFix = useRef<LocationFix | null>(null);
  const accessPolicy = useRef(new GeolocationAccessPolicy());
  const stopWatching = useRef<(() => void) | null>(null);
  const [watchAttempt, setWatchAttempt] = useState(0);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; requestId.current += 1; };
  }, []);

  const acceptPosition = useCallback((fix: LocationFix) => {
    if (!active.current || !getAppActivity() || !isPosition(fix)) return false;
    const problem=gpsProblem(fix,lastReliableFix.current);
    if(problem){setError(problem);return false;}
    const timestamp = fix.timestamp ?? Date.now();
    if (!Number.isFinite(timestamp) || timestamp > Date.now() + 5000 || timestamp < Date.now() - 30000 ||
      (fix.accuracy !== undefined && (!Number.isFinite(fix.accuracy) || fix.accuracy < 0))) return false;
    if (timestamp < latestTimestamp.current) return false;
    latestTimestamp.current = timestamp;
    lastReliableFix.current={...fix,timestamp};
    setPosition({ ...fix, timestamp });
    setError('');
    return true;
  }, []);

  const locate = useCallback(async () => {
    if (!getAppActivity()) return null;
    const id = ++requestId.current;
    stopWatching.current?.();
    accessPolicy.current.beginManualAttempt();
    const permissionRevision = accessPolicy.current.currentRevision();
    setLoading(true);
    setError('');
    try {
      const pos = await getCurrentDevicePosition();
      if (!active.current || !getAppActivity() || id !== requestId.current) return null;
      if (!isPosition(pos)) throw new Error('El GPS devolvió coordenadas inválidas.');
      if (!acceptPosition(pos)) throw new Error('El GPS devolvió una ubicación antigua o inválida. Vuelve a intentar obtener tu posición.');
      return pos;
    } catch (err) {
      const failure = normalizeGeolocationError(err);
      // Leaving the foreground invalidates position/UI delivery, but the user's
      // permission decision still applies until a newer explicit attempt starts.
      if (active.current && isGeolocationDenial(failure)) accessPolicy.current.observeError(failure, permissionRevision);
      if (active.current && id === requestId.current) {
        if (!isGeolocationDenial(failure)) accessPolicy.current.observeError(failure, permissionRevision);
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
    if (!foreground) {
      requestId.current++;
      accessPolicy.current.finishManualAttempt();
      setLoading(false);
    }
    if (!foreground || !autoWatch || !accessPolicy.current.canWatchAutomatically()) return;
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
  }, [autoWatch, foreground, acceptPosition, watchAttempt]);

  return {
    position,
    loading,
    error,
    locate,
    setPosition,
  };
}
