import React, { useState, useEffect, useRef } from 'react';
import { AuthGate } from '../components/layout/AuthGate';
import { useAuth } from '../hooks/useAuth';
import { AuthService } from '../services/auth';
import { NavigationService, type SavedRoute } from '../services/navigation';
import { api, formatDate, errorMessage } from '../services/api';
import { ProfileOperationScope, submitProfileRecovery } from '../services/profileOperations';
import { triggerHaptic } from '../services/native';
import { SpotifyService } from '../services/spotify';
import { User, ShieldCheck, Mail, Phone, Bookmark, Trash2, Medal, LogOut, KeyRound, Music, Settings } from 'lucide-react';
import type { ParticipationSummaryData } from '../types';

interface ProfilePageProps {
  onGoLogin: () => void;
  onGoRegister: () => void;
  onGoVerify: () => void;
  onGoCommunity?: () => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  onGoLogin,
  onGoRegister,
  onGoVerify,
  onGoCommunity,
}) => {
  const { usuario, logout, refresh } = useAuth();
  const [nicknameInput, setNicknameInput] = useState(usuario?.nickname || '');
  const [favorites, setFavorites] = useState<SavedRoute[]>([]);
  const [participation, setParticipation] = useState<ParticipationSummaryData | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Password change state
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Phone recovery state
  const [showPhoneRecovery, setShowPhoneRecovery] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [recoveryReason, setRecoveryReason] = useState('');
  const [idFile, setIdFile] = useState<File | null>(null);

  // Spotify integration state
  const [spotifyEnabled, setSpotifyEnabled] = useState(false);
  const [spotifyBusy, setSpotifyBusy] = useState(false);
  const [deletingFavorite, setDeletingFavorite] = useState<number | null>(null);
  const account = useRef(usuario?.id);
  account.current = usuario?.id;
  const operations = useRef(new ProfileOperationScope(() => account.current));

  useEffect(() => {
    const controller = new AbortController();
    operations.current.activate(usuario?.id);
    setFavorites([]);
    setParticipation(null);
    setError(''); setMessage('');
    setOldPassword(''); setNewPassword('');
    setNewPhone(''); setRecoveryReason(''); setIdFile(null);
    setShowPasswordChange(false); setShowPhoneRecovery(false);
    setBusy(false);
    setDeletingFavorite(null); setSpotifyBusy(false);
    if (!usuario) return () => { controller.abort(); operations.current.invalidate(); };
    const owner = usuario.id;
    setNicknameInput(usuario.nickname);

    NavigationService.getFavorites(controller.signal)
      .then((items) => { if (!controller.signal.aborted && account.current === owner) setFavorites(items); })
      .catch((err) => { if (!controller.signal.aborted && account.current === owner) setError(`Favoritos: ${errorMessage(err)}`); });

    api<ParticipationSummaryData>('/participation', { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted && account.current === owner) setParticipation(data); })
      .catch((err) => { if (!controller.signal.aborted && account.current === owner) setError(`Participación: ${errorMessage(err)}`); });

    SpotifyService.isEnabled()
      .then((enabled) => { if (!controller.signal.aborted && account.current === owner) setSpotifyEnabled(enabled); });
    return () => { controller.abort(); operations.current.invalidate(); };
  }, [usuario?.id]);

  useEffect(() => { setNicknameInput(usuario?.nickname || ''); }, [usuario?.nickname]);

  const handleToggleSpotify = async (checked: boolean) => {
    void triggerHaptic('light');
    if (spotifyBusy) return;
    const operation = operations.current.start();
    if (!operation.isCurrent()) return;
    setSpotifyBusy(true);
    try {
      await SpotifyService.setEnabled(checked);
      if (operation.isCurrent()) setSpotifyEnabled(checked);
    } catch (err) { if (operation.isCurrent()) setError(`No se pudo guardar la preferencia: ${errorMessage(err)}`); }
    finally { if (operation.isCurrent()) setSpotifyBusy(false); operation.finish(); }
  };

  const handleUpdateNickname = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nicknameInput.trim() || nicknameInput === usuario?.nickname) return;
    const operation = operations.current.start();
    if (!operation.isCurrent()) return;
    void triggerHaptic('light');
    setBusy(true);
    setError('');
    setMessage('');

    try {
      await AuthService.updateNickname(nicknameInput.trim(), operation.signal);
      if (!operation.isCurrent()) return;
      await refresh();
      if (operation.isCurrent()) setMessage('Nickname actualizado correctamente.');
    } catch (err) {
      if (operation.isCurrent()) setError(errorMessage(err));
    } finally {
      if (operation.isCurrent()) setBusy(false);
      operation.finish();
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const operation = operations.current.start();
    if (!operation.isCurrent()) return;
    void triggerHaptic('medium');
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const res = await AuthService.changePassword(oldPassword, newPassword, operation.signal);
      if (!operation.isCurrent()) return;
      setMessage(res.mensaje || 'Contraseña actualizada.');
      setShowPasswordChange(false);
      setOldPassword('');
      setNewPassword('');
    } catch (err) {
      if (operation.isCurrent()) setError(errorMessage(err));
    } finally {
      if (operation.isCurrent()) setBusy(false);
      operation.finish();
    }
  };

  const handlePhoneRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    const operation = operations.current.start();
    if (!operation.isCurrent()) return;
    void triggerHaptic('medium');
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const submitted = await submitProfileRecovery(operation, { telefonoNuevo: newPhone.trim(), motivo: recoveryReason.trim() }, idFile);
      if (!submitted || !operation.isCurrent()) return;

      setMessage('Solicitud enviada al administrador.');
      setShowPhoneRecovery(false);
      setNewPhone('');
      setRecoveryReason('');
      setIdFile(null);
    } catch (err) {
      if (operation.isCurrent()) setError(errorMessage(err));
    } finally {
      if (operation.isCurrent()) setBusy(false);
      operation.finish();
    }
  };

  const handleDeleteFavorite = async (id: number) => {
    if (deletingFavorite !== null) return;
    const operation = operations.current.start();
    if (!operation.isCurrent()) return;
    setDeletingFavorite(id);
    setError('');
    void triggerHaptic('light');
    try {
      await NavigationService.removeFavorite(id, operation.signal);
      if (operation.isCurrent()) setFavorites((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      if (operation.isCurrent()) setError(`No se pudo eliminar el favorito: ${errorMessage(err)}`);
    } finally { if (operation.isCurrent()) setDeletingFavorite(null); operation.finish(); }
  };

  const handleLogout = async () => {
    const operation = operations.current.start();
    if (!operation.isCurrent()) return;
    void triggerHaptic('heavy');
    setBusy(true);
    try { await logout(); }
    catch (err) { if (operation.isCurrent()) setError(errorMessage(err)); }
    finally { if (operation.isCurrent()) setBusy(false); operation.finish(); }
  };

  return (
    <div className="page" style={{ paddingBottom: 'calc(40px + var(--safe-bottom))' }}>
      <div className="page-heading">
        <span className="eyebrow">MI CUENTA</span>
        <h1>Perfil CiviGo</h1>
        <p className="muted">Gestiona tus datos de acceso, rutas guardadas y participación ciudadana.</p>
      </div>

      <AuthGate onGoLogin={onGoLogin} onGoRegister={onGoRegister}>
        {error && <div className="notice notice-error">{error}</div>}
        {message && <div className="notice notice-success">{message}</div>}

        {/* User Card */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  backgroundColor: 'var(--brand-soft)',
                  color: 'var(--brand)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: 18,
                }}
              >
                {usuario?.nickname.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 style={{ fontSize: 16, margin: 0 }}>{usuario?.nickname}</h2>
                <span className="muted" style={{ fontSize: 12 }}>
                  {usuario?.nombres} {usuario?.apellidos}
                </span>
              </div>
            </div>

            <span className="badge">
              {usuario?.rol === 'ADMIN' ? 'Administrador' : usuario?.rol === 'AGENTE' ? 'Agente Ica' : 'Ciudadano'}
            </span>
          </div>

          <div className="grid-2" style={{ marginTop: 12, marginBottom: 16 }}>
            <div className="stat">
              <strong>{usuario?.credibilidad ?? '—'}</strong>
              <span>Credibilidad ciudadana</span>
            </div>
            <div className="stat">
              <strong>{Number(usuario?.monedas || 0).toLocaleString('es-PE')}</strong>
              <span>Monedas CiviGo</span>
            </div>
          </div>

          <form onSubmit={handleUpdateNickname}>
            <div className="field">
              <label htmlFor="nick-input">Nickname público</label>
              <input
                id="nick-input"
                type="text"
                value={nicknameInput}
                onChange={(e) => setNicknameInput(e.target.value)}
                maxLength={30}
                minLength={3}
                required
              />
            </div>
            <button
              type="submit"
              className="btn btn-secondary btn-small"
              disabled={busy || !usuario?.correoVerificado || nicknameInput === usuario?.nickname}
            >
              Guardar nickname
            </button>
            {!usuario?.correoVerificado && (
              <small className="muted" style={{ display: 'block', marginTop: 6 }}>
                Requiere verificar Gmail antes de cambiar el nickname.
              </small>
            )}
          </form>
        </div>

        {/* Contact Info Card */}
        <div className="card">
          <div className="card-header">
            <h2>Contactos y verificación</h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Mail size={18} color="var(--brand)" />
              <div style={{ flex: 1 }}>
                <strong style={{ fontSize: 13, display: 'block' }}>{usuario?.correo}</strong>
                <span className="muted" style={{ fontSize: 11 }}>
                  {usuario?.correoVerificado ? 'Correo verificado con Google' : 'No verificado'}
                </span>
              </div>
              {!usuario?.correoVerificado && (
                <button
                  type="button"
                  className="btn btn-primary btn-small"
                  onClick={onGoVerify}
                >
                  <ShieldCheck size={14} />
                  <span>Verificar</span>
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Phone size={18} color="var(--brand)" />
              <div style={{ flex: 1 }}>
                <strong style={{ fontSize: 13, display: 'block' }}>{usuario?.telefono}</strong>
                <span className="muted" style={{ fontSize: 11 }}>Número privado de contacto</span>
              </div>
              <button
                type="button"
                className="btn btn-quiet btn-small"
                onClick={() => setShowPhoneRecovery(!showPhoneRecovery)}
              >
                Cambiar
              </button>
            </div>
          </div>

          {/* Change phone subform */}
          {showPhoneRecovery && (
            <form onSubmit={handlePhoneRecovery} style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div className="field">
                <label htmlFor="rec-phone">Nuevo número (+51...)</label>
                <input
                  id="rec-phone"
                  type="tel"
                  placeholder="+51987654321"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="rec-reason">Motivo del cambio</label>
                <textarea
                  id="rec-reason"
                  placeholder="Explica la razón de cambio de número..."
                  value={recoveryReason}
                  onChange={(e) => setRecoveryReason(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="rec-file">Documento de identidad (DNI)</label>
                <input
                  id="rec-file"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setIdFile(e.target.files?.[0] || null)}
                />
              </div>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
                Enviar solicitud de cambio
              </button>
            </form>
          )}

          {/* Password change toggle */}
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-secondary btn-small btn-full"
              onClick={() => setShowPasswordChange(!showPasswordChange)}
            >
              <KeyRound size={16} />
              <span>Cambiar contraseña</span>
            </button>
          </div>

          {showPasswordChange && (
            <form onSubmit={handleChangePassword} style={{ marginTop: 12 }}>
              <div className="field">
                <label htmlFor="old-pass">Contraseña actual</label>
                <input
                  id="old-pass"
                  type="password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="new-pass">Nueva contraseña (mínimo 10 caracteres)</label>
                <input
                  id="new-pass"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={10}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
                Actualizar contraseña
              </button>
            </form>
          )}
        </div>

        {/* Participation & Badges */}
        {participation && (
          <div className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Medal size={18} color="var(--brand)" />
                <h2 style={{ fontSize: 15 }}>Tu participación en {participation.mes}</h2>
              </div>
              {onGoCommunity && (
                <button
                  type="button"
                  className="btn btn-quiet btn-small"
                  onClick={onGoCommunity}
                >
                  Ver ranking
                </button>
              )}
            </div>

            <div className="grid-2" style={{ marginBottom: 12 }}>
              <div className="stat">
                <strong>{participation.puntosMensuales}</strong>
                <span>Puntos del mes</span>
              </div>
              <div className="stat">
                <strong>{participation.reportesValidados}</strong>
                <span>Reportes validados</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
              {participation.insignias.map((ins) => (
                <div
                  key={ins.id}
                  style={{
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                    backgroundColor: ins.obtenida ? 'var(--surface)' : 'var(--surface-muted)',
                    opacity: ins.obtenida ? 1 : 0.6,
                    minWidth: 120,
                    flexShrink: 0,
                  }}
                >
                  <Medal size={18} color={ins.obtenida ? 'var(--brand)' : 'var(--muted)'} />
                  <strong style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                    {ins.nombre}
                  </strong>
                  <span className="muted" style={{ fontSize: 10 }}>{ins.descripcion}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Favorite Routes */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Bookmark size={18} color="var(--brand)" />
              <h2 style={{ fontSize: 15 }}>Rutas favoritas ({favorites.length}/{usuario?.premium ? 20 : 3})</h2>
            </div>
          </div>

          {favorites.length === 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>
              Guarda tus trayectos más frecuentes desde el mapa interactivo.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {favorites.map((fav) => (
                <div
                  key={fav.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: 8,
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--line)',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 13 }}>{fav.nombre || 'Recorrido guardado'}</strong>
                    <span className="muted" style={{ fontSize: 11, display: 'block' }}>
                      {(fav.datos.distancia / 1000).toFixed(1)} km · {Math.round(fav.datos.duracion / 60)} min
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ width: 30, height: 30 }}
                    onClick={() => handleDeleteFavorite(fav.id)}
                    disabled={deletingFavorite !== null}
                    aria-label="Eliminar favorito"
                  >
                    <Trash2 size={15} color="var(--error-ink)" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* App & Media Preferences */}
        <div className="card">
          <div className="card-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Settings size={18} color="var(--brand)" />
              <h2 style={{ fontSize: 15 }}>Preferencias de navegación</h2>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '12px',
              borderRadius: 8,
              backgroundColor: 'var(--surface-subtle)',
              border: '1px solid var(--line)',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                backgroundColor: spotifyEnabled ? '#1DB954' : 'var(--surface-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Music size={16} color={spotifyEnabled ? '#000' : 'var(--muted)'} />
            </div>

            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  margin: 0,
                }}
              >
                <div>
                  <strong style={{ fontSize: 13, display: 'block' }}>
                    Spotify durante la navegación
                  </strong>
                  <span className="muted" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                    Muestra un acceso para abrir Spotify. No hay una cuenta conectada ni controles de reproducción dentro de CiviGo. Desactivado por defecto.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={spotifyEnabled}
                  disabled={spotifyBusy}
                  onChange={(e) => void handleToggleSpotify(e.target.checked)}
                  style={{ marginLeft: 12, width: 18, height: 18, cursor: 'pointer' }}
                />
              </label>
            </div>
          </div>
        </div>

        {/* Logout */}
        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            className="btn btn-danger btn-full"
            onClick={handleLogout}
            disabled={busy}
          >
            <LogOut size={16} />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </AuthGate>
    </div>
  );
};
