import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation, type Position } from '@capacitor/geolocation';
import { Preferences } from '@capacitor/preferences';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Network, type ConnectionStatus } from '@capacitor/network';
import { App } from '@capacitor/app';
import type { Posicion, LocationFix } from '../types';

export const isNative = Capacitor.isNativePlatform();

/* --- HAPTICS --- */
export async function triggerHaptic(type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' = 'light') {
  if (!isNative) return;
  try {
    if (type === 'light') await Haptics.impact({ style: ImpactStyle.Light });
    else if (type === 'medium') await Haptics.impact({ style: ImpactStyle.Medium });
    else if (type === 'heavy') await Haptics.impact({ style: ImpactStyle.Heavy });
    else if (type === 'success') await Haptics.notification({ type: NotificationType.Success });
    else if (type === 'warning') await Haptics.notification({ type: NotificationType.Warning });
    else if (type === 'error') await Haptics.notification({ type: NotificationType.Error });
  } catch {
    // Haptics not supported or permitted
  }
}

/* --- GEOLOCATION --- */
export async function getCurrentDevicePosition(): Promise<LocationFix> {
  if (isNative) {
    try {
      const permission = await Geolocation.checkPermissions();
      if (permission.location !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted') {
          throw new Error('Permiso de GPS denegado. Habilita la ubicación en los ajustes.');
        }
      }
      const pos: Position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      });
      return {
        latitud: pos.coords.latitude,
        longitud: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        heading: pos.coords.heading ?? undefined,
        speed: pos.coords.speed ?? undefined,
        timestamp: pos.timestamp,
      };
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error('No se pudo obtener la ubicación GPS.');
    }
  }

  // Fallback for browser testing
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('Este dispositivo no soporta geolocalización.'));
    }
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitud: p.coords.latitude,
          longitud: p.coords.longitude,
          accuracy: p.coords.accuracy,
          heading: p.coords.heading ?? undefined,
          speed: p.coords.speed ?? undefined,
          timestamp: p.timestamp,
        }),
      () => reject(new Error('No se pudo obtener la ubicación GPS.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  });
}

export const getCurrentPosition = getCurrentDevicePosition;

export function watchDevicePosition(
  onSuccess: (pos: LocationFix) => void,
  onError?: (err: Error) => void
): () => void {
  let watchId: string | number | null = null;
  let active = true;

  if (isNative) {
    Geolocation.watchPosition(
      { enableHighAccuracy: true },
      (pos, err) => {
        if (!active) return;
        if (err) {
          onError?.(new Error(err.message));
          return;
        }
        if (pos) {
          onSuccess({
            latitud: pos.coords.latitude,
            longitud: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading ?? undefined,
            speed: pos.coords.speed ?? undefined,
            timestamp: pos.timestamp,
          });
        }
      }
    ).then((id) => {
      watchId = id;
    });

    return () => {
      active = false;
      if (watchId !== null) Geolocation.clearWatch({ id: watchId as string });
    };
  }

  // Browser fallback
  if (navigator.geolocation) {
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (!active) return;
        onSuccess({
          latitud: p.coords.latitude,
          longitud: p.coords.longitude,
          accuracy: p.coords.accuracy,
          heading: p.coords.heading ?? undefined,
          speed: p.coords.speed ?? undefined,
          timestamp: p.timestamp,
        });
      },
      (err) => onError?.(new Error(err.message)),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );
    return () => {
      active = false;
      navigator.geolocation.clearWatch(id);
    };
  }

  return () => {};
}

/* --- CAMERA / GALLERY --- */
export interface CapturedMedia {
  file: File;
  previewUrl: string;
}

export async function capturePhotoOrVideo(
  source: 'camera' | 'photos' = 'camera'
): Promise<CapturedMedia | null> {
  if (isNative) {
    try {
      const image = await Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      });

      if (!image.webPath) return null;
      const response = await fetch(image.webPath);
      const blob = await response.blob();
      const filename = `civigo-media-${Date.now()}.${image.format || 'jpg'}`;
      const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
      return { file, previewUrl: image.webPath };
    } catch (err: any) {
      if (err?.message?.includes('cancelled') || err?.message?.includes('User cancelled')) {
        return null;
      }
      throw new Error('Error al acceder a la cámara o galería: ' + (err?.message || ''));
    }
  }

  // Web input fallback handled by input[type=file]
  return null;
}

/* --- PERSISTENT STORAGE (Preferences) --- */
const memoryStore = new Map<string, string>();

export const StorageService = {
  async get(key: string): Promise<string | null> {
    try {
      const { value } = await Preferences.get({ key });
      return value;
    } catch {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
      return memoryStore.get(key) ?? null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await Preferences.set({ key, value });
    } catch {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      } else {
        memoryStore.set(key, value);
      }
    }
  },
  async remove(key: string): Promise<void> {
    try {
      await Preferences.remove({ key });
    } catch {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      } else {
        memoryStore.delete(key);
      }
    }
  },
};

/* --- NETWORK STATUS --- */
export async function getNetworkStatus(): Promise<ConnectionStatus> {
  try {
    return await Network.getStatus();
  } catch {
    return { connected: navigator.onLine, connectionType: 'unknown' };
  }
}

export function onNetworkChange(callback: (status: ConnectionStatus) => void): () => void {
  let removeListener: (() => void) | null = null;
  Network.addListener('networkStatusChange', callback).then((handle) => {
    removeListener = () => handle.remove();
  });
  return () => {
    if (removeListener) removeListener();
  };
}

/* --- ANDROID HARDWARE BACK BUTTON --- */
export function onHardwareBackButton(callback: () => void): () => void {
  if (!isNative) return () => {};
  let removeListener: (() => void) | null = null;
  App.addListener('backButton', () => {
    callback();
  }).then((handle) => {
    removeListener = () => handle.remove();
  });
  return () => {
    if (removeListener) removeListener();
  };
}
