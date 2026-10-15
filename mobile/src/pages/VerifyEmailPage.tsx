import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { AuthService } from '../services/auth';
import { triggerHaptic } from '../services/native';
import { errorMessage } from '../services/api';
import { ShieldCheck, CheckCircle2, ArrowLeft, Mail } from 'lucide-react';

interface VerifyEmailPageProps {
  onBack: () => void;
  onGoMap: () => void;
}

export const VerifyEmailPage: React.FC<VerifyEmailPageProps> = ({
  onBack,
  onGoMap,
}) => {
  const { usuario, refresh } = useAuth();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);

  const handleStartVerification = async () => {
    if (!consent) return;
    void triggerHaptic('medium');
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const res = await AuthService.requestGoogleEmail();
      setChallenge(res.challengeId);
      setMessage('Solicitud de comprobación con Google generada correctamente. El sistema verificará tu titularidad.');
      await refresh();
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
        <span className="eyebrow">VERIFICACIÓN GOOGLE</span>
        <h1 style={{ marginTop: 8 }}>Verifica tu dirección Gmail</h1>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
          Para participar activamente, publicar reportes y confirmar incidentes en Ica, comprobamos que eres el titular de tu Gmail.
        </p>

        {error && <div className="notice notice-error">{error}</div>}
        {message && <div className="notice notice-success">{message}</div>}

        {usuario?.correoVerificado ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <CheckCircle2 size={48} color="var(--success-ink)" style={{ margin: '0 auto 12px' }} />
            <h2 style={{ color: 'var(--success-ink)' }}>¡Tu correo ya está verificado!</h2>
            <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
              Tu cuenta está plenamente habilitada para reportar incidentes y participar en la comunidad de CiviGo.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-full"
              onClick={onGoMap}
            >
              Explorar el mapa
            </button>
          </div>
        ) : (
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px',
                borderRadius: 10,
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--line)',
                marginBottom: 16,
              }}
            >
              <Mail size={22} color="var(--brand)" />
              <div>
                <strong style={{ fontSize: 13, display: 'block' }}>{usuario?.correo}</strong>
                <span className="muted" style={{ fontSize: 11 }}>Dirección Gmail registrada</span>
              </div>
            </div>

            <label className="inline-checkbox" style={{ marginBottom: 20 }}>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={busy}
              />
              <span>
                Acepto que CiviGo compruebe mi dirección de Gmail para validar la autenticidad de mi cuenta ciudadana.
              </span>
            </label>

            <button
              type="button"
              className="btn btn-primary btn-full"
              disabled={busy || !consent}
              onClick={handleStartVerification}
            >
              {busy ? 'Generando solicitud…' : 'Comprobar con Google'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-quiet btn-small"
                onClick={onGoMap}
              >
                Continuar navegando en el mapa
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
