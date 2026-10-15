import React, { useState } from 'react';
import { AuthService } from '../services/auth';
import { triggerHaptic } from '../services/native';
import { errorMessage } from '../services/api';
import { ArrowLeft, KeyRound, Mail } from 'lucide-react';

interface ForgotPasswordPageProps {
  onBack: () => void;
  onGoLogin: () => void;
}

export const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({
  onBack,
  onGoLogin,
}) => {
  const [hasToken, setHasToken] = useState(false);
  const [correo, setCorreo] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    void triggerHaptic('medium');
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const res = await AuthService.forgotPassword(correo.trim());
      setMessage(res.mensaje || 'Si existe una cuenta asociada, recibirás un enlace/código de recuperación.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleFinishReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    void triggerHaptic('medium');
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const res = await AuthService.resetPassword(token.trim(), newPassword);
      setMessage(res.mensaje || 'Contraseña actualizada. Ya puedes iniciar sesión.');
      setTimeout(() => {
        onGoLogin();
      }, 2000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ paddingTop: 20 }}>
      <button
        type="button"
        className="icon-btn"
        onClick={onBack}
        style={{ marginBottom: 16 }}
        aria-label="Volver"
      >
        <ArrowLeft size={20} />
      </button>

      <div className="card">
        <span className="eyebrow">RECUPERACIÓN</span>
        <h1 style={{ marginTop: 8 }}>Recuperar contraseña</h1>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
          {hasToken
            ? 'Ingresa el código o token recibido y define tu nueva contraseña.'
            : 'Te enviaremos las instrucciones de restablecimiento a tu correo registrado.'}
        </p>

        {error && <div className="notice notice-error">{error}</div>}
        {message && <div className="notice notice-success">{message}</div>}

        {!hasToken ? (
          <form onSubmit={handleRequestReset}>
            <div className="field">
              <label htmlFor="forgot-correo">Correo electrónico</label>
              <input
                id="forgot-correo"
                type="email"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                placeholder="tu.correo@gmail.com"
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-full"
              disabled={busy}
            >
              {busy ? 'Enviando…' : 'Enviar instrucciones'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-quiet btn-small"
                onClick={() => setHasToken(true)}
                style={{ color: 'var(--brand)' }}
              >
                ¿Ya tienes un código o token?
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleFinishReset}>
            <div className="field">
              <label htmlFor="reset-token">Token o código recibido</label>
              <input
                id="reset-token"
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="reset-pass">Nueva contraseña (mínimo 10 caracteres)</label>
              <input
                id="reset-pass"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={10}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="reset-confirm">Confirmar contraseña</label>
              <input
                id="reset-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={10}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-full"
              disabled={busy}
            >
              {busy ? 'Actualizando…' : 'Cambiar contraseña'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-quiet btn-small"
                onClick={() => setHasToken(false)}
              >
                Volver a solicitar correo
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
