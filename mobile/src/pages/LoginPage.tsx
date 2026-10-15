import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { AuthService } from '../services/auth';
import { triggerHaptic } from '../services/native';
import { ApiError, errorMessage } from '../services/api';
import { LogIn, ArrowLeft } from 'lucide-react';

interface LoginPageProps {
  onSuccess: () => void;
  onGoRegister: () => void;
  onGoForgot: () => void;
  onBack: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onSuccess,
  onGoRegister,
  onGoForgot,
  onBack,
}) => {
  const { refresh } = useAuth();
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    void triggerHaptic('medium');
    setBusy(true);
    setError('');

    try {
      await AuthService.login(correo.trim(), password);
      // The cookie belongs to the app even if this screen was left meanwhile.
      await refresh();
      if (!active.current) return;
      void triggerHaptic('success');
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ACCOUNT_BLOCKED') await refresh();
      if (!active.current) return;
      setError(errorMessage(err));
      void triggerHaptic('error');
    } finally {
      if (active.current) setBusy(false);
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
        <span className="eyebrow">COMUNIDAD CIVIGO</span>
        <h1 style={{ marginTop: 8 }}>Qué bueno verte de nuevo</h1>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
          Ingresa a tu cuenta para ver tus reportes ciudadanos y recorridos en Ica.
        </p>

        {error && <div className="notice notice-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="login-correo">Correo electrónico</label>
            <input
              id="login-correo"
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              placeholder="ejemplo@gmail.com"
              required
              disabled={busy}
              autoComplete="email"
            />
          </div>

          <div className="field">
            <label htmlFor="login-password">Contraseña</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={busy}
              autoComplete="current-password"
              maxLength={128}
            />
          </div>

          <div style={{ textAlign: 'right', marginBottom: 16 }}>
            <button
              type="button"
              className="btn btn-quiet btn-small"
              onClick={onGoForgot}
              style={{ padding: 0, fontSize: 12, color: 'var(--brand)' }}
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={busy}
          >
            {busy ? 'Iniciando sesión…' : 'Iniciar sesión'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 13 }}>
          <span className="muted">¿Primera vez en CiviGo? </span>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={onGoRegister}
            style={{ padding: 0, color: 'var(--brand)', fontWeight: 700 }}
          >
            Crea tu cuenta
          </button>
        </div>
      </div>
    </div>
  );
};
