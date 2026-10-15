import React from 'react';
import { useAuth } from '../../hooks/useAuth';
import { ShieldCheck, LogIn, UserPlus } from 'lucide-react';

interface AuthGateProps {
  children: React.ReactNode;
  participation?: boolean;
  onGoLogin?: () => void;
  onGoRegister?: () => void;
  onGoVerify?: () => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  children,
  participation = false,
  onGoLogin,
  onGoRegister,
  onGoVerify,
}) => {
  const { usuario, loading, offline } = useAuth();

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '36px 16px' }}>
        <p className="muted">Cargando sesión…</p>
      </div>
    );
  }

  if (!usuario) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--brand-soft)',
            color: 'var(--brand)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <LogIn size={26} />
        </div>
        <h2>Inicia sesión para continuar</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
          Para aportar reportes, consultar tus rutas guardadas y participar en la comunidad de CiviGo, ingresa a tu cuenta.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            className="btn btn-primary btn-full"
            onClick={onGoLogin}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-full"
            onClick={onGoRegister}
          >
            Crear cuenta nueva
          </button>
        </div>
      </div>
    );
  }

  if (participation && !usuario.correoVerificado) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--warning-bg)',
            color: 'var(--warning-ink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <ShieldCheck size={26} />
        </div>
        <h2>Verifica tu correo</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
          Tu cuenta ({usuario.correo}) aún no ha sido verificada con Google. Es necesario verificarla para publicar reportes ciudadanos.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-full"
          onClick={onGoVerify}
        >
          Verificar con Google
        </button>
      </div>
    );
  }

  return <>{children}</>;
};
