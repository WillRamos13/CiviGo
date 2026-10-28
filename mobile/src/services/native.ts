import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation, type Position } from '@capacitor/geolocation';
import { Preferences } from '@capacitor/preferences';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Network, type ConnectionStatus } from '@capacitor/network';
import { App } from '@capacitor/app';
import type { Posicion, LocationFix } from '../types';
import { subscribeAsync } from './native-lifecycle';
import { isGeolocationDenial, normalizeGeolocationError } from './geolocation-consent';
import { ReportCameraRecovery, type RecoveredReportPhoto } from './cameraRecovery';
import { ResilientStorage, type JournalStorage, type PreferenceDriver } from './resilientStorage';

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
          throw normalizeGeolocationError({ code: 'OS-PLUG-GLOC-0003', message: 'Location permission request was denied.' });
        }
      }
      const pos: Position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
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
      throw normalizeGeolocationError(err);
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
      (err) => reject(normalizeGeolocationError(err)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

export const getCurrentPosition = getCurrentDevicePosition;

export function watchDevicePosition(
  onSuccess: (pos: LocationFix) => void,
  onError?: (err: Error) => void
): () => void {
  let active = true;

  if (isNative) {
    const stop = subscribeAsync(async isActive => {
      const id = await Geolocation.watchPosition(
      { enableHighAccuracy: true },
      (pos, err) => {
        if (err) {
          const failure = normalizeGeolocationError(err);
          // Consent may finish after a foreground watch was stopped. Only a
          // denial reaches the consent policy; closed views still receive no fix.
          if (isActive() || isGeolocationDenial(failure)) onError?.(failure);
          return;
        }
        if (!isActive()) return;
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
      );
      return () => Geolocation.clearWatch({ id });
    }, err => onError?.(normalizeGeolocationError(err)));
    return stop;
  }

  // Browser fallback
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
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
      (err) => {
        const failure = normalizeGeolocationError(err);
        if (active || isGeolocationDenial(failure)) onError?.(failure);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    return () => {
      active = false;
      navigator.geolocation.clearWatch(id);
    };
  }

  onError?.(new Error('Este dispositivo no soporta geolocalización.'));
  return () => { active = false; };
}

/* --- CAMERA / GALLERY --- */
export interface CapturedMedia {
  file: File;
  previewUrl: string;
}

export async function capturePhotoOrVideo(
  source: 'camera' | 'photos' = 'camera', ownerId?: number,
): Promise<CapturedMedia | null> {
  if (isNative) {
    let pending: string | undefined;
    try {
      if (ownerId) pending = await reportCameraRecovery.begin(ownerId);
      const image = await Camera.getPhoto({
        quality: 85,
        width: 2048,
        height: 2048,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      });

      return image.webPath ? await loadCameraPhoto(image as { webPath: string; format: string }) : null;
    } catch (err: any) {
      if (err?.message?.includes('cancelled') || err?.message?.includes('User cancelled')) {
        return null;
      }
      throw new Error('Error al acceder a la cámara o galería: ' + (err?.message || ''));
    } finally { if (pending) await reportCameraRecovery.finish(pending).catch(() => {}); }
  }

  // Web input fallback handled by input[type=file]
  return null;
}

/* --- PERSISTENT STORAGE (Preferences) --- */
const memoryStore = new Map<string, string>();
const memoryFallback: JournalStorage = {
  getItem: key => memoryStore.get(key) ?? null,
  setItem: (key, value) => { memoryStore.set(key, value); },
  removeItem: key => { memoryStore.delete(key); },
};
const memoryPreferences: PreferenceDriver = {
  get: async ({ key }) => ({ value: memoryStore.get('CapacitorStorage.' + key) ?? null }),
  set: async ({ key, value }) => { memoryStore.set('CapacitorStorage.' + key, value); },
  remove: async ({ key }) => { memoryStore.delete('CapacitorStorage.' + key); },
};
const storagePreferences = !isNative && typeof window === 'undefined' && typeof document === 'undefined' ? memoryPreferences : Preferences;
export const StorageService = new ResilientStorage(storagePreferences, () => {
  if (typeof localStorage !== 'undefined') return localStorage;
  // Memory is only a server/test fallback. A native device or browser must not
  // report a durable logout/trip deletion when storage is inaccessible.
  if (isNative || typeof document !== 'undefined') throw new Error('No se pudo acceder al almacenamiento local de CiviGo.');
  return memoryFallback;
});

const reportCameraRecovery = new ReportCameraRecovery(StorageService, typeof location === 'undefined' ? 'https://localhost' : location.origin);
export const getRecoveredReportPhoto = (ownerId: number | undefined) => reportCameraRecovery.read(ownerId);
export const consumeRecoveredReportPhoto = (photo: RecoveredReportPhoto) => reportCameraRecovery.consume(photo.ownerId, photo.nonce);
export const discardRecoveredReportPhotos = (ownerId: number | undefined) => reportCameraRecovery.discard(ownerId);

async function loadCameraPhoto(photo: { webPath: string; format: string }): Promise<CapturedMedia> {
  const response = await fetch(photo.webPath);
  if (!response.ok) throw new Error('No se pudo recuperar la fotografía local.');
  const blob = await response.blob();
  if (!blob.size || blob.size > 15 * 1024 * 1024) throw new Error('La fotografía está vacía o supera el límite de 15 MB.');
  const format = ['jpeg', 'jpg', 'png', 'gif', 'webp'].includes(photo.format) ? photo.format : 'jpg';
  const mime = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
  const file = new File([blob], `civigo-media-${Date.now()}.${format}`, { type: mime });
  return { file, previewUrl: photo.webPath };
}

export async function loadRecoveredReportPhoto(photo: RecoveredReportPhoto): Promise<CapturedMedia> {
  const current = await reportCameraRecovery.read(photo.ownerId);
  if (!current || current.nonce !== photo.nonce) throw new Error('La fotografía recuperada ya no está disponible.');
  return loadCameraPhoto(current);
}

// Capacitor retains this event until JavaScript registers its listener after
// Android recreates the process. Only a previously owned capture is accepted.
if (isNative) {
  const startupCapture = reportCameraRecovery.snapshot().catch(() => null);
  void App.addListener('appRestoredResult', result => {
    void startupCapture.then(nonce => reportCameraRecovery.restore(result, nonce)).catch(() => {});
  }).catch(() => {});
}

/* --- NETWORK STATUS --- */
export async function getNetworkStatus(): Promise<ConnectionStatus> {
  try {
    return await Network.getStatus();
  } catch {
    return { connected: typeof navigator !== 'undefined' ? navigator.onLine : true, connectionType: 'unknown' };
  }
}

export function onNetworkChange(callback: (status: ConnectionStatus) => void): () => void {
  return subscribeAsync(async isActive => {
    const handle = await Network.addListener('networkStatusChange', status => {
      if (isActive()) callback(status);
    });
    return () => handle.remove();
  });
}

/* --- ANDROID HARDWARE BACK BUTTON --- */
export async function minimizeAndroidApp(): Promise<void> {
  if (!isNative) return;
  try { await App.minimizeApp(); }
  catch { try { await App.exitApp(); } catch { /* The native activity may already be closing. */ } }
}

export function onHardwareBackButton(callback: () => void): () => void {
  if (!isNative) return () => {};
  return subscribeAsync(async isActive => {
    const handle = await App.addListener('backButton', () => {
      if (isActive()) callback();
    });
    return () => handle.remove();
  });
}
