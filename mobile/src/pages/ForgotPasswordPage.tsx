import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { AuthService } from '../services/auth';
import { triggerHaptic } from '../services/native';
import { errorMessage } from '../services/api';
import { consumePasswordResetLocation, isPasswordResetLocation, passwordResetToken } from '../services/password-recovery';
import { ArrowLeft } from 'lucide-react';

interface ForgotPasswordPageProps { onBack: () => void; onGoLogin: () => void; }

export const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({ onBack, onGoLogin }) => {
  const { refresh } = useAuth();
  const [hasToken, setHasToken] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [correo, setCorreo] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const active = useRef(false);

  useEffect(() => {
    active.current = true;
    if (isPasswordResetLocation(window.location.href)) {
      const token = consumePasswordResetLocation(window.location, window.history);
      setHasToken(true);
      if (token) setTokenInput(token);
      else setError('El enlace de recuperación no es válido. Solicita uno nuevo.');
    }
    return () => { active.current = false; };
  }, []);

  const handleRequestReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    void triggerHaptic('medium');
    try {
      const result = await AuthService.forgotPassword(correo.trim().toLowerCase());
      if (!active.current) return;
      setMessage(result.mensaje || 'Si existe una cuenta con ese correo, recibirás un enlace para restablecer tu contraseña.');
    } catch (err) { if (active.current) setError(errorMessage(err)); }
    finally { if (active.current) setBusy(false); }
  };

  const handleFinishReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const token = passwordResetToken(tokenInput);
    if (!token) { setError('Pega el enlace completo del correo de CiviGo o su código de recuperación de 64 caracteres.'); return; }
    if (newPassword !== confirmPassword) { setError('Las contraseñas no coinciden.'); return; }
    if (newPassword.length < 10 || newPassword.length > 128) { setError('Usa una contraseña de 10 a 128 caracteres.'); return; }
    setBusy(true); setError(''); setMessage('');
    void triggerHaptic('medium');
    try {
      const result = await AuthService.resetPassword(token, newPassword);
      if (!active.current) return;
      setTokenInput(''); setNewPassword(''); setConfirmPassword('');
      await refresh();
      if (!active.current) return;
      setCompleted(true);
      setMessage(result.mensaje || 'Contraseña actualizada. Inicia sesión de nuevo en tus dispositivos.');
      void triggerHaptic('success');
    } catch (err) { if (active.current) setError(errorMessage(err)); }
    finally { if (active.current) setBusy(false); }
  };

  return (
    <div className="page" style={{ paddingTop: 20 }}>
      <button type="button" className="icon-btn" onClick={onBack} style={{ marginBottom: 16 }} aria-label="Volver"><ArrowLeft size={20} /></button>
      <div className="card">
        <span className="eyebrow">RECUPERACIÓN</span>
        <h1 style={{ marginTop: 8 }}>Recuperar contraseña</h1>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>{completed ? 'Ya puedes ingresar con tu nueva contraseña.' : hasToken ? 'Pega el enlace del correo y elige tu nueva contraseña. El enlace funciona una sola vez y vence en 15 minutos.' : 'Te enviaremos las instrucciones de restablecimiento a tu correo registrado.'}</p>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {message && <div className="notice notice-success" role="status">{message}</div>}
        {completed ? <button type="button" className="btn btn-primary btn-full" onClick={onGoLogin}>Ir a iniciar sesión</button> : !hasToken ? (
          <form onSubmit={handleRequestReset}>
            <div className="field"><label htmlFor="forgot-correo">Correo electrónico</label><input id="forgot-correo" type="email" value={correo} onChange={event => setCorreo(event.target.value)} placeholder="tu.correo@gmail.com" autoComplete="email" maxLength={254} required disabled={busy} /></div>
            <button type="submit" className="btn btn-primary btn-full" disabled={busy}>{busy ? 'Enviando…' : 'Enviar instrucciones'}</button>
            <div style={{ textAlign: 'center', marginTop: 16 }}><button type="button" className="btn btn-quiet btn-small" onClick={() => { setHasToken(true); setError(''); setMessage(''); }} disabled={busy}>Ya tengo el enlace del correo</button></div>
          </form>
        ) : (
          <form onSubmit={handleFinishReset}>
            <div className="field"><label htmlFor="reset-token">Enlace o código de recuperación</label><input id="reset-token" type="password" value={tokenInput} onChange={event => setTokenInput(event.target.value)} placeholder="Pega el enlace completo de CiviGo" autoComplete="off" spellCheck={false} maxLength={2048} required disabled={busy} /></div>
            <div className="field"><label htmlFor="reset-pass">Nueva contraseña (10 a 128 caracteres)</label><input id="reset-pass" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required disabled={busy} /></div>
            <div className="field"><label htmlFor="reset-confirm">Confirmar contraseña</label><input id="reset-confirm" type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required disabled={busy} /></div>
            <button type="submit" className="btn btn-primary btn-full" disabled={busy}>{busy ? 'Actualizando…' : 'Cambiar contraseña'}</button>
            <div style={{ textAlign: 'center', marginTop: 16 }}><button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => { setHasToken(false); setTokenInput(''); setNewPassword(''); setConfirmPassword(''); setError(''); setMessage(''); }}>Volver a solicitar correo</button></div>
          </form>
        )}
      </div>
    </div>
  );
};
