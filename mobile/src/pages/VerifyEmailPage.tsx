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
  const [projectId, setProjectId] = useState<string | null>(null);
  const [idToken, setIdToken] = useState('');

  const handleStartVerification = async () => {
    if (!consent) return;
    void triggerHaptic('medium');
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const res = await AuthService.requestGoogleEmail();
      setChallenge(res.challengeId);
      setProjectId(res.projectId || null);
      setMessage(`Ticket #${res.challengeId} generado. Ingresa el token de comprobación de Google para completar la validación.`);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge || !idToken.trim()) {
      setError('Por favor ingresa la credencial o comprobante de Google.');
      return;
    }
    void triggerHaptic('heavy');
    setBusy(true);
    setError('');
    setMessage('');

    try {
      await AuthService.verifyGoogleEmail(challenge, idToken.trim());
      setMessage('¡Gmail verificado correctamente con Google! Ya puedes participar y reportar.');
      setChallenge(null);
      setIdToken('');
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

            {!challenge ? (
              <>
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
              </>
            ) : (
              <form onSubmit={handleCompleteVerification} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div
                  style={{
                    padding: '12px',
                    borderRadius: 8,
                    backgroundColor: 'var(--surface-muted)',
                    fontSize: 12,
                    border: '1px solid var(--line)',
                  }}
                >
                  <p style={{ margin: '0 0 6px', fontWeight: 600, color: 'var(--brand)' }}>
                    Ticket de verificación #{challenge}
                  </p>
                  <p className="muted" style={{ margin: 0 }}>
                    Proyecto: {projectId || 'CiviGo Ica'}. Para completar la verificación de titularidad, ingresa el ID token de Google o presiona Validar.
                  </p>
                </div>

                <div className="field">
                  <label>Comprobante / Google ID Token</label>
                  <textarea
                    rows={3}
                    placeholder="Pega el idToken emitido por Google Auth..."
                    value={idToken}
                    onChange={(e) => setIdToken(e.target.value)}
                    required
                    style={{ fontSize: 11, fontFamily: 'monospace' }}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-full"
                  disabled={busy || !idToken.trim()}
                >
                  {busy ? 'Verificando con servidor…' : 'Confirmar verificación Google'}
                </button>

                <button
                  type="button"
                  className="btn btn-quiet btn-small"
                  onClick={() => setChallenge(null)}
                  disabled={busy}
                >
                  Cancelar y generar nueva solicitud
                </button>
              </form>
            )}

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
