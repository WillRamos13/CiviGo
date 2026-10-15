import { useState, useEffect, useCallback } from 'react';
import { getCurrentDevicePosition, watchDevicePosition } from '../services/native';
import type { LocationFix } from '../types';

export function useGeolocation(autoWatch = false) {
  const [position, setPosition] = useState<LocationFix | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const locate = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const pos = await getCurrentDevicePosition();
      setPosition(pos);
      return pos;
    } catch (err: any) {
      const msg = err?.message || 'No se pudo obtener la ubicación GPS.';
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoWatch) return;
    const unsub = watchDevicePosition(
      (pos) => {
        setPosition(pos);
        setError('');
      },
      (err) => {
        setError(err.message);
      }
    );
    return () => unsub();
  }, [autoWatch]);

  return {
    position,
    loading,
    error,
    locate,
    setPosition,
  };
}
