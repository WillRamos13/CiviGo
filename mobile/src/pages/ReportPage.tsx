import React, { useState, useEffect } from 'react';
import { Camera, Image as ImageIcon, MapPin, Check, AlertCircle, FileCheck, ArrowRight } from 'lucide-react';
import { AuthGate } from '../components/layout/AuthGate';
import { MapView } from '../components/map/MapView';
import { IncidentIcon } from '../components/map/IncidentIcon';
import { api, crearReporte, upload, distance, errorMessage } from '../services/api';
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
  const [result, setResult] = useState<any | null>(null);

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

  // Restore draft on mount
  useEffect(() => {
    StorageService.get('civigo:report-draft')
      .then((raw) => {
        if (!raw) return;
        try {
          const draft = JSON.parse(raw);
          if (draft.slug) setSelectedSlug(draft.slug);
          if (draft.description) setDescription(draft.description);
          if (draft.eventDate) setEventDate(draft.eventDate);
        } catch {
          // ignore corrupted draft
        }
      })
      .catch(() => {});
  }, []);

  // Auto-save draft when fields change
  useEffect(() => {
    if (result) return;
    if (selectedSlug || description || eventDate) {
      void StorageService.set(
        'civigo:report-draft',
        JSON.stringify({
          slug: selectedSlug,
          description,
          eventDate,
        })
      );
    }
  }, [selectedSlug, description, eventDate, result]);

  const selectedTipo = catalog?.categorias
    .flatMap((c) => c.tipos)
    .find((t) => t.slug === selectedSlug);

  const handleLocate = async () => {
    setLocating(true);
    setError('');
    void triggerHaptic('light');
    try {
      const pos = await getCurrentDevicePosition();
      const coords = { latitud: pos.latitud, longitud: pos.longitud };
      setGps(coords);
      setPosition(coords);
      setCorrectLocation(false);
    } catch (err: any) {
      setError(err?.message || 'No se pudo obtener la ubicación GPS.');
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

  const handleCaptureCamera = async () => {
    if (files.length >= 3) {
      setError('Solo se permiten hasta 3 archivos adjuntos.');
      return;
    }
    void triggerHaptic('medium');
    try {
      const media = await capturePhotoOrVideo('camera');
      if (media) {
        setFiles((prev) => [...prev, { file: media.file, preview: media.previewUrl }]);
        setError('');
      }
    } catch (err: any) {
      setError(err?.message || 'Error al usar la cámara.');
    }
  };

  const handlePickPhotos = async () => {
    if (files.length >= 3) {
      setError('Solo se permiten hasta 3 archivos adjuntos.');
      return;
    }
    void triggerHaptic('light');
    try {
      const media = await capturePhotoOrVideo('photos');
      if (media) {
        setFiles((prev) => [...prev, { file: media.file, preview: media.previewUrl }]);
        setError('');
      }
    } catch (err: any) {
      setError(err?.message || 'Error al abrir la galería.');
    }
  };

  const handleWebFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list) return;
    const added = Array.from(list).map((file) => ({
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));
    if (files.length + added.length > 3) {
      setError('Máximo 3 archivos en total.');
      return;
    }
    setFiles((prev) => [...prev, ...added]);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!selectedTipo) return setError('Selecciona el tipo de incidente.');
    if (!position || !correctLocation) return setError('Confirma que la ubicación es correcta.');
    if (!selectedTipo.ubicacionRemota && !gps) return setError('Obtén tu ubicación GPS antes de enviar.');
    if (selectedTipo.fotoObligatoria && files.length === 0) return setError('Este tipo de incidente requiere al menos una fotografía.');
    if (gps && !selectedTipo.ubicacionRemota && distance(gps, position) > 50) {
      return setError('La ubicación supera los 50 metros desde el GPS.');
    }

    void triggerHaptic('heavy');
    setBusy(true);

    const uploadedIds: string[] = [];
    try {
      for (const item of files) {
        const res = await upload(item.file, selectedTipo.individual);
        uploadedIds.push(res.id);
      }

      const reportData = {
        tipo: selectedSlug,
        descripcion: description.trim(),
        ...position,
        gpsLatitud: gps?.latitud,
        gpsLongitud: gps?.longitud,
        fechaEvento: eventDate ? new Date(eventDate).toISOString() : new Date().toISOString(),
        adjuntosIds: uploadedIds,
      };

      const res = await crearReporte(reportData);
      setResult(res);
      await StorageService.remove('civigo:report-draft');
      void triggerHaptic('success');
    } catch (err) {
      // Cleanup uploaded files on failure
      for (const id of uploadedIds) {
        void api(`/uploads/${id}`, { method: 'DELETE' }).catch(() => {});
      }
      setError(errorMessage(err));
      void triggerHaptic('error');
    } finally {
      setBusy(false);
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
        {result ? (
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

              {/* Native Mobile Camera Buttons */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={handleCaptureCamera}
                  disabled={files.length >= 3 || busy}
                >
                  <Camera size={18} />
                  <span>Tomar foto</span>
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={handlePickPhotos}
                  disabled={files.length >= 3 || busy}
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
                      accept="image/*,video/*"
                      multiple
                      className="sr-only"
                      onChange={handleWebFileInput}
                      disabled={files.length >= 3 || busy}
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
                        onClick={() => setFiles(files.filter((_, i) => i !== index))}
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

              {position && (
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
                disabled={busy || !selectedTipo}
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
