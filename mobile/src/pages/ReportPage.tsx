import React, { useState, useEffect, useRef } from 'react';
import { Camera, Image as ImageIcon, MapPin, Check, AlertCircle, FileCheck, ArrowRight } from 'lucide-react';
import { AuthGate } from '../components/layout/AuthGate';
import { useAuth } from '../hooks/useAuth';
import { MapView } from '../components/map/MapView';
import { IncidentIcon } from '../components/map/IncidentIcon';
import { api, crearReporte, distance, errorMessage } from '../services/api';
import { REPORT_FILE_ACCEPT, reportVideoLimit, submitReportWithEvidence, validateEvidenceFile } from '../services/reportEvidence';
import { clearReportDraft, readReportDraft, reportDraftKey, saveReportDraft } from '../services/reportDraft';
import { getCurrentDevicePosition, capturePhotoOrVideo, triggerHaptic, isNative, StorageService } from '../services/native';
import type { Catalogo, Posicion, TipoIncidente } from '../types';

interface ReportPageProps {
  onGoLogin: () => void;
  onGoRegister: () => void;
  onGoVerify: () => void;
  onGoMyReports: () => void;
  onGoMap: () => void;
}

export const ReportPage: React.FC<ReportPageProps> = ({
  onGoLogin,
  onGoRegister,
  onGoVerify,
  onGoMyReports,
  onGoMap,
}) => {
  const { usuario } = useAuth();
  const draftKey = reportDraftKey(usuario?.id);
  const [draftReadyFor, setDraftReadyFor] = useState<string | null>(null);
  const sessionKeyRef = useRef(draftKey);
  const previousUserId = useRef<number | undefined>(usuario?.id);
  const mountedRef = useRef(true);
  sessionKeyRef.current = draftKey;
  const [catalog, setCatalog] = useState<Catalogo | null>(null);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [description, setDescription] = useState('');
  const [gps, setGps] = useState<Posicion | null>(null);
  const [position, setPosition] = useState<Posicion | null>(null);
  const [correctLocation, setCorrectLocation] = useState(false);
  const [eventDate, setEventDate] = useState('');
  const [files, setFiles] = useState<{ file: File; preview?: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof crearReporte>> | null>(null);
  const [selectingMedia, setSelectingMedia] = useState(false);
  const filesRef = useRef(files);
  const pickingRef = useRef(false);
  const submittingRef = useRef(false);
  const submissionController = useRef<AbortController | null>(null);
  filesRef.current = files;

  useEffect(() => {
    mountedRef.current = true;
    // The old unscoped draft has no verified owner and is never restored.
    void StorageService.remove('civigo:report-draft').catch(() => {});
    return () => {
      mountedRef.current = false;
      submissionController.current?.abort();
      for (const item of filesRef.current) if (item.preview) URL.revokeObjectURL(item.preview);
    };
  }, []);

  // Load incident categories
  useEffect(() => {
    let ok = true;
    api<Catalogo>('/catalog')
      .then((data) => {
        if (ok) setCatalog(data);
      })
      .catch((e) => {
        if (ok) setError(errorMessage(e));
      });
    return () => {
      ok = false;
    };
  }, []);

  // Restore only the current account's draft and clear transient state on account changes.
  useEffect(() => {
    let active = true;
    const userId = usuario?.id;
    const previousId = previousUserId.current;
    previousUserId.current = userId;
    submissionController.current?.abort();
    if (!userId && previousId) void clearReportDraft(previousId, StorageService).catch(() => {});
    setDraftReadyFor(null);
    setSelectedSlug(''); setDescription(''); setEventDate('');
    setGps(null); setPosition(null); setCorrectLocation(false); setResult(null); setError('');
    for (const item of filesRef.current) if (item.preview) URL.revokeObjectURL(item.preview);
    filesRef.current = [];
    setFiles([]);
    if (!draftKey) return;
    readReportDraft(userId, StorageService).then((draft) => {
      if (!active || !draft) return;
      setSelectedSlug(draft.slug); setDescription(draft.description); setEventDate(draft.eventDate);
    }).catch(() => {}).finally(() => { if (active) setDraftReadyFor(draftKey); });
    return () => { active = false; };
  }, [usuario?.id, draftKey]);

  // Auto-save draft when fields change
  useEffect(() => {
    if (result || !draftKey || draftReadyFor !== draftKey) return;
    void saveReportDraft(usuario?.id, { slug: selectedSlug, description, eventDate }, StorageService).catch(() => {});
  }, [selectedSlug, description, eventDate, result, draftKey, draftReadyFor, usuario?.id]);

  const selectedTipo = catalog?.categorias
    .flatMap((c) => c.tipos)
    .find((t) => t.slug === selectedSlug);

  const handleLocate = async () => {
    const session = draftKey;
    setLocating(true);
    setError('');
    void triggerHaptic('light');
    try {
      const pos = await getCurrentDevicePosition();
      if (!mountedRef.current || session !== sessionKeyRef.current) return;
      const coords = { latitud: pos.latitud, longitud: pos.longitud };
      setGps(coords);
      setPosition(coords);
      setCorrectLocation(false);
    } catch (err: any) {
      if (mountedRef.current && session === sessionKeyRef.current) setError(err?.message || 'No se pudo obtener la ubicación GPS.');
    } finally {
      setLocating(false);
    }
  };

  const handleAdjustLocation = (p: Posicion) => {
    if (!selectedTipo) return;
    if (!selectedTipo.ubicacionRemota && !gps) {
      setError('Obtén tu ubicación GPS antes de ajustar la posición en el mapa.');
      return;
    }
    if (!selectedTipo.ubicacionRemota && gps && distance(gps, p) > 50) {
      setError('Solo puedes corregir la posición hasta 50 metros respecto al GPS.');
      return;
    }
    setPosition(p);
    setCorrectLocation(false);
    setError('');
  };

  const addMedia = async (picked: File[]) => {
    const session = draftKey;
    if (filesRef.current.length + picked.length > 3) throw new Error('Máximo 3 archivos en total.');
    for (const file of picked) await validateEvidenceFile(file, reportVideoLimit(catalog?.config?.maxVideoBytes));
    if (!mountedRef.current || session !== sessionKeyRef.current) return;
    const added = picked.map((file) => ({ file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined }));
    const next = [...filesRef.current, ...added];
    filesRef.current = next;
    setFiles(next);
    setError('');
  };

  const pickMedia = async (source: 'camera' | 'photos') => {
    const session = draftKey;
    if (pickingRef.current || submittingRef.current) return;
    if (files.length >= 3) {
      setError('Solo se permiten hasta 3 archivos adjuntos.');
      return;
    }
    pickingRef.current = true;
    setSelectingMedia(true);
    void triggerHaptic(source === 'camera' ? 'medium' : 'light');
    try {
      const media = await capturePhotoOrVideo(source);
      if (media && session === sessionKeyRef.current) await addMedia([media.file]);
    } catch (err) {
      if (mountedRef.current && session === sessionKeyRef.current) setError(errorMessage(err));
    } finally {
      pickingRef.current = false;
      setSelectingMedia(false);
    }
  };

  const handleWebFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const session = draftKey;
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!picked.length || pickingRef.current || submittingRef.current) return;
    pickingRef.current = true;
    setSelectingMedia(true);
    try { await addMedia(picked); }
    catch (err) { if (mountedRef.current && session === sessionKeyRef.current) setError(errorMessage(err)); }
    finally { pickingRef.current = false; setSelectingMedia(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || pickingRef.current) return;
    const session = draftKey;
    const userId = usuario?.id;
    if (!userId || !session || draftReadyFor !== session) return;
    setError('');

    if (!selectedTipo) return setError('Selecciona el tipo de incidente.');
    if (!position || !correctLocation) return setError('Confirma que la ubicación es correcta.');
    if (!selectedTipo.ubicacionRemota && !gps) return setError('Obtén tu ubicación GPS antes de enviar.');
    if (gps && !selectedTipo.ubicacionRemota && distance(gps, position) > 50) {
      return setError('La ubicación supera los 50 metros desde el GPS.');
    }
    const occurredAt = selectedTipo.ubicacionRemota && eventDate ? new Date(eventDate) : new Date();
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 60000
      || occurredAt.getTime() < Date.now() - 7 * 86400000) {
      return setError('La fecha debe estar dentro de la última semana y no puede ser futura.');
    }

    void triggerHaptic('heavy');
    const controller = new AbortController();
    submissionController.current = controller;
    submittingRef.current = true;
    setBusy(true);

    try {
      const reportData = {
        tipo: selectedSlug,
        descripcion: description.trim(),
        ...position,
        gpsLatitud: gps?.latitud,
        gpsLongitud: gps?.longitud,
        fechaEvento: occurredAt.toISOString(),
      };

      const res = await submitReportWithEvidence(reportData, files.map((item) => item.file), {
        ...selectedTipo, maxVideoBytes: reportVideoLimit(catalog?.config?.maxVideoBytes),
      }, undefined, { signal: controller.signal, isCurrent: () => mountedRef.current && session === sessionKeyRef.current });
      if (!mountedRef.current || session !== sessionKeyRef.current) return;
      setResult(res);
      await clearReportDraft(userId, StorageService).catch(() => {});
      void triggerHaptic('success');
    } catch (err) {
      if (mountedRef.current && session === sessionKeyRef.current) setError(errorMessage(err));
      void triggerHaptic('error');
    } finally {
      if (submissionController.current === controller) submissionController.current = null;
      setBusy(false);
      submittingRef.current = false;
    }
  };

  return (
    <div className="page" style={{ paddingBottom: 'calc(40px + var(--safe-bottom))' }}>
      <div className="page-heading">
        <span className="eyebrow">TU VOZ EN ICA</span>
        <h1>Reportar un incidente</h1>
        <p className="muted">Informa sobre riesgos viales, incidentes o emergencias en tu entorno.</p>
      </div>

      <AuthGate
        participation
        onGoLogin={onGoLogin}
        onGoRegister={onGoRegister}
        onGoVerify={onGoVerify}
      >
        {draftKey && draftReadyFor !== draftKey ? <div className="card"><p className="muted">Cargando tu borrador…</p></div> : result ? (
          <div className="card" style={{ textAlign: 'center', padding: '28px 16px' }}>
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                backgroundColor: 'var(--success-bg)',
                color: 'var(--success-ink)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}
            >
              <FileCheck size={32} />
            </div>

            <h2>¡Reporte #{result.reporte.id} recibido!</h2>
            <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
              {result.revision?.requerida
                ? 'Tu reporte requiere revisión humana por un agente antes de su validación final.'
                : 'Tu reporte ha sido procesado por el sistema de evaluación de CiviGo.'}
            </p>

            {result.revision?.mensaje && (
              <div className="notice notice-warning" style={{ textAlign: 'left', marginBottom: 16 }}>
                <strong>Aviso de revisión: </strong>
                {result.revision.mensaje}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-primary btn-full"
                onClick={onGoMyReports}
              >
                Ver en Mis Reportes
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-full"
                onClick={onGoMap}
              >
                Volver al Mapa
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div className="notice notice-error">{error}</div>}

            {/* Step 1: Type */}
            <div className="card">
              <div className="card-header">
                <h2>1. ¿Qué ocurrió?</h2>
                <span className="badge">Reporte</span>
              </div>

              <div className="field">
                <label htmlFor="tipo-select">Tipo de incidente</label>
                <select
                  id="tipo-select"
                  value={selectedSlug}
                  onChange={(e) => {
                    setSelectedSlug(e.target.value);
                    setEventDate('');
                    setPosition(gps);
                    setCorrectLocation(false);
                  }}
                  required
                >
                  <option value="">Selecciona el tipo de hecho</option>
                  {catalog?.categorias.map((cat) => (
                    <optgroup key={cat.id} label={cat.nombre}>
                      {cat.tipos.map((t) => (
                        <option key={t.id} value={t.slug}>
                          {t.nombre}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {selectedTipo && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
                  <IncidentIcon
                    tipo={selectedTipo.nombre}
                    slug={selectedTipo.slug}
                    size={42}
                  />
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15 }}>{selectedTipo.nombre}</h3>
                    <small className="muted">
                      {selectedTipo.individual
                        ? 'Reporte individual: evidencias privadas.'
                        : 'Puede agruparse con otros reportes cercanos en Ica.'}
                    </small>
                  </div>
                </div>
              )}

              <div className="field">
                <label htmlFor="descripcion">Descripción (opcional)</label>
                <textarea
                  id="descripcion"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe detalles observables del hecho..."
                  maxLength={2000}
                />
              </div>

              {selectedTipo?.ubicacionRemota && (
                <div className="field">
                  <label htmlFor="fecha">¿Cuándo ocurrió?</label>
                  <input
                    id="fecha"
                    type="datetime-local"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                  />
                  <small>Permite hechos de hasta 7 días atrás.</small>
                </div>
              )}
            </div>

            {/* Step 2: Camera & Evidence */}
            <div className="card">
              <div className="card-header">
                <h2>2. Fotos o videos</h2>
                <span className="badge">{files.length}/3</span>
              </div>
              <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                {selectedTipo?.fotoObligatoria
                  ? 'Este incidente requiere al menos una fotografía como evidencia.'
                  : 'Adjunta fotos claras para facilitar la validación por IA o agentes.'}
              </p>
              <small className="muted" style={{ display: 'block', marginBottom: 12 }}>
                Fotos JPEG, PNG, WebP o GIF: hasta 15 MB. Videos MP4, MOV o WebM cortos: hasta {Math.round(reportVideoLimit(catalog?.config?.maxVideoBytes) / 1048576)} MB.
              </small>

              {/* Native Mobile Camera Buttons */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => pickMedia('camera')}
                  disabled={files.length >= 3 || busy || selectingMedia}
                >
                  <Camera size={18} />
                  <span>Tomar foto</span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => pickMedia('photos')}
                  disabled={files.length >= 3 || busy || selectingMedia}
                >
                  <ImageIcon size={18} />
                  <span>Galería</span>
                </button>
              </div>

              {/* Web file input fallback */}
              {!isNative && (
                <div style={{ textAlign: 'center', marginBottom: 10 }}>
                  <label className="btn btn-quiet btn-small">
                    <span>O seleccionar archivos locales</span>
                    <input
                      type="file"
                      accept={REPORT_FILE_ACCEPT}
                      multiple
                      className="sr-only"
                      onChange={handleWebFileInput}
                      disabled={files.length >= 3 || busy || selectingMedia}
                    />
                  </label>
                </div>
              )}

              {/* Media Preview Chips */}
              {files.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {files.map((item, index) => (
                    <div
                      key={index}
                      style={{
                        position: 'relative',
                        width: 72,
                        height: 72,
                        borderRadius: 8,
                        overflow: 'hidden',
                        border: '1px solid var(--line)',
                      }}
                    >
                      {item.preview ? (
                        <img
                          src={item.preview}
                          alt="Adjunto"
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'var(--surface-muted)',
                          }}
                        >
                          <ImageIcon size={20} color="var(--muted)" />
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={busy || selectingMedia}
                        onClick={() => {
                          if (item.preview) URL.revokeObjectURL(item.preview);
                          const next = files.filter((_, i) => i !== index);
                          filesRef.current = next;
                          setFiles(next);
                        }}
                        style={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          background: 'rgba(0,0,0,0.6)',
                          color: '#fff',
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 10,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Step 3: Location */}
            <div className="card">
              <div className="card-header">
                <h2>3. Ubicación del hecho</h2>
                <span className="badge">GPS</span>
              </div>

              <button
                type="button"
                className="btn btn-secondary btn-full"
                onClick={handleLocate}
                disabled={locating || !selectedTipo}
                style={{ marginBottom: 12 }}
              >
                <MapPin size={18} color="var(--brand)" />
                <span>{locating ? 'Obteniendo GPS…' : 'Usar mi ubicación GPS actual'}</span>
              </button>

              {(position || selectedTipo?.ubicacionRemota) && (
                <div style={{ height: 220, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
                  <MapView
                    editor
                    posicion={position}
                    onSelectCoordinates={handleAdjustLocation}
                  />
                </div>
              )}

              {position && (
                <label className="inline-checkbox">
                  <input
                    type="checkbox"
                    checked={correctLocation}
                    onChange={(e) => setCorrectLocation(e.target.checked)}
                  />
                  <span>
                    <strong>Confirmo que la ubicación es correcta</strong>
                    <br />
                    El marcador señala el punto exacto donde ocurrió el incidente.
                  </span>
                </label>
              )}
            </div>

            {/* Submit */}
            <div className="card">
              <button
                type="submit"
                className="btn btn-primary btn-full"
                disabled={busy || selectingMedia || !selectedTipo}
              >
                {busy ? 'Enviando reporte…' : 'Publicar reporte ciudadano'}
              </button>
              <small className="muted" style={{ display: 'block', textAlign: 'center', marginTop: 10 }}>
                CiviGo promueve la seguridad comunitaria en Ica. No sustituye las líneas de emergencia 105 / 116.
              </small>
            </div>
          </form>
        )}
      </AuthGate>
    </div>
  );
};
