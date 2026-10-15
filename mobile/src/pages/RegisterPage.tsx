import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { AuthService } from '../services/auth';
import { triggerHaptic } from '../services/native';
import { errorMessage } from '../services/api';
import { ArrowLeft } from 'lucide-react';

interface RegisterPageProps {
  onSuccess: () => void;
  onGoLogin: () => void;
  onBack: () => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({
  onSuccess,
  onGoLogin,
  onBack,
}) => {
  const { refresh } = useAuth();
  const [nombre, setNombre] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [nickname, setNickname] = useState('');
  const [correo, setCorreo] = useState('');
  const [telefono, setTelefono] = useState('+51');
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!correo.trim().toLowerCase().endsWith('@gmail.com')) {
      setError('Debes registrarte con una dirección @gmail.com para verificarla con Google.');
      return;
    }
    if (!acceptTerms) {
      setError('Debes aceptar los términos sobre la veracidad de los reportes.');
      return;
    }
    if (!/^[\p{L}\p{N}_ .-]{3,30}$/u.test(nickname.trim())) {
      setError('Usa un nickname de 3 a 30 caracteres con letras, números, espacios, puntos o guiones.');
      return;
    }

    void triggerHaptic('medium');
    setBusy(true);
    setError('');

    try {
      await AuthService.register({
        nombre: nombre.trim(),
        apellidos: apellidos.trim(),
        nickname: nickname.trim(),
        correo: correo.trim().toLowerCase(),
        telefono: telefono.trim(),
        fechaNacimiento,
        password,
      });

      if (!active.current) return;
      await refresh();
      if (!active.current) return;
      void triggerHaptic('success');
      onSuccess();
    } catch (err) {
      if (!active.current) return;
      setError(errorMessage(err));
      void triggerHaptic('error');
    } finally {
      if (active.current) setBusy(false);
    }
  };

  return (
    <div className="page" style={{ paddingTop: 20, paddingBottom: 40 }}>
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
        <h1 style={{ marginTop: 8 }}>Tu ciudad necesita tu voz</h1>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
          Crea tu cuenta y empieza a recorrer Ica con más información y seguridad.
        </p>

        {error && <div className="notice notice-error" role="alert">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="reg-nombre">Nombres</label>
              <input
                id="reg-nombre"
                autoComplete="given-name"
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
                disabled={busy}
                maxLength={100}
              />
            </div>
            <div className="field">
              <label htmlFor="reg-apellidos">Apellidos</label>
              <input
                id="reg-apellidos"
                autoComplete="family-name"
                type="text"
                value={apellidos}
                onChange={(e) => setApellidos(e.target.value)}
                required
                disabled={busy}
                maxLength={100}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="reg-nick">Nickname público</label>
            <input
              id="reg-nick"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              minLength={3}
              maxLength={30}
              required
              disabled={busy}
            />
            <small>La comunidad verá este nombre. Usa letras, números, espacios, puntos o guiones.</small>
          </div>

          <div className="field">
            <label htmlFor="reg-correo">Correo Gmail (@gmail.com)</label>
            <input
              id="reg-correo"
              autoComplete="email"
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              placeholder="tu.usuario@gmail.com"
              required
              disabled={busy}
              maxLength={254}
            />
            <small>Usa tu dirección @gmail.com para comprobarla con Google.</small>
          </div>

          <div className="field">
            <label htmlFor="reg-tel">Teléfono de contacto privado</label>
            <input
              id="reg-tel"
              autoComplete="tel"
              maxLength={25}
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="+51987654321"
              required
              disabled={busy}
            />
            <small>Dato privado. Incluye código de país.</small>
          </div>

          <div className="field">
            <label htmlFor="reg-birth">Fecha de nacimiento</label>
            <input
              id="reg-birth"
              autoComplete="bday"
              type="date"
              value={fechaNacimiento}
              onChange={(e) => setFechaNacimiento(e.target.value)}
              required
              disabled={busy}
            />
            <small>Edad mínima para registrarse: 12 años.</small>
          </div>

          <div className="field">
            <label htmlFor="reg-pass">Contraseña (mínimo 10 caracteres)</label>
            <input
              id="reg-pass"
              autoComplete="new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              maxLength={128}
              required
              disabled={busy}
            />
          </div>

          <label className="inline-checkbox" style={{ margin: '16px 0 20px' }}>
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              required
              disabled={busy}
            />
            <span>
              Entiendo que mis datos personales son privados y que los reportes deben describir hechos reales.
            </span>
          </label>

          <button
            type="submit"
            className="btn btn-primary btn-full"
            disabled={busy}
          >
            {busy ? 'Creando cuenta…' : 'Crear mi cuenta'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 13 }}>
          <span className="muted">¿Ya tienes cuenta? </span>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={onGoLogin}
            style={{ padding: 0, color: 'var(--brand)', fontWeight: 700 }}
          >
            Inicia sesión
          </button>
        </div>
      </div>
    </div>
  );
};
