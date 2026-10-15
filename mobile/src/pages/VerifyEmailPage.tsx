import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { AuthService } from '../services/auth';
import { triggerHaptic } from '../services/native';
import { ApiError, errorMessage } from '../services/api';
import { firebaseEmailConfig, GoogleEmailFlow, googleEmailErrorMessage } from '../services/firebase-email';
import { CheckCircle2, ArrowLeft, Mail } from 'lucide-react';

interface VerifyEmailPageProps { onBack: () => void; onGoMap: () => void; }

export const VerifyEmailPage: React.FC<VerifyEmailPageProps> = ({ onBack, onGoMap }) => {
  const { usuario, refresh, offline } = useAuth();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const currentFlow = useRef<GoogleEmailFlow | null>(null);

  useEffect(() => {
    const flow = new GoogleEmailFlow(firebaseEmailConfig());
    currentFlow.current = flow;
    setPrepared(false);
    setBusy(false);
    return () => { currentFlow.current = null; flow.dispose(); };
  }, [usuario?.id, usuario?.correo, attempt]);

  const handleVerification = async () => {
    const flow = currentFlow.current;
    if (!flow || busy || !consent || !usuario || offline) return;
    setBusy(true);
    setError('');
    setMessage('');
    void triggerHaptic('medium');
    try {
      if (!prepared) {
        await flow.prepare(() => AuthService.requestGoogleEmail());
        if (currentFlow.current !== flow) return;
        setPrepared(true);
        setMessage('Todo listo. Continúa con Google y elige la misma cuenta Gmail que registraste en CiviGo.');
      } else {
        // SDK and challenge were prepared by the previous click. Opening Google
        // now preserves the user gesture required by mobile browser popups.
        await flow.verify(usuario.correo, proof => AuthService.verifyGoogleEmail(proof.challengeId, proof.idToken));
        if (currentFlow.current !== flow) return;
        setPrepared(false);
        setMessage('¡Gmail verificado! Ya puedes publicar reportes y participar.');
        void triggerHaptic('success');
        await refresh();
      }
    } catch (err) {
      if (currentFlow.current !== flow) return;
      setPrepared(flow.prepared);
      if (err instanceof ApiError && err.code === 'EMAIL_ALREADY_VERIFIED') {
        await refresh();
      } else {
        setError(err instanceof ApiError ? errorMessage(err) : googleEmailErrorMessage(err));
        void triggerHaptic('error');
      }
    } finally { if (currentFlow.current === flow) setBusy(false); }
  };

  return (
    <div className="page" style={{ paddingTop: 20 }}>
      <button type="button" className="icon-btn" onClick={onBack} style={{ marginBottom: 16 }} aria-label="Volver"><ArrowLeft size={20} /></button>
      <div className="card">
        <span className="eyebrow">VERIFICACIÓN GOOGLE</span>
        <h1 style={{ marginTop: 8 }}>Verifica tu dirección Gmail</h1>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>Comprueba que eres titular del Gmail de tu cuenta para publicar reportes y confirmar incidentes en Ica.</p>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {message && <div className="notice notice-success" role="status">{message}</div>}
        {usuario?.correoVerificado ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <CheckCircle2 size={48} color="var(--success-ink)" style={{ margin: '0 auto 12px' }} />
            <h2 style={{ color: 'var(--success-ink)' }}>¡Tu correo ya está verificado!</h2>
            <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>Tu correo está habilitado para participar en la comunidad de CiviGo.</p>
            <button type="button" className="btn btn-primary btn-full" onClick={onGoMap}>Explorar el mapa</button>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, backgroundColor: 'var(--surface-subtle)', border: '1px solid var(--line)', marginBottom: 16 }}>
              <Mail size={22} color="var(--brand)" />
              <div><strong style={{ fontSize: 13, display: 'block' }}>{usuario?.correo || 'Inicia sesión para verificar tu correo'}</strong><span className="muted" style={{ fontSize: 11 }}>Dirección Gmail registrada</span></div>
            </div>
            {offline && <div className="notice" role="status">Necesitas conexión para verificar tu Gmail con Google.</div>}
            <label className="inline-checkbox" style={{ marginBottom: 20 }}>
              <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy || prepared} />
              <span>Acepto que CiviGo compruebe mi dirección Gmail para validar mi cuenta ciudadana.</span>
            </label>
            <button type="button" className="btn btn-primary btn-full" disabled={busy || !consent || !usuario || offline} onClick={handleVerification}>
              {busy ? (prepared ? 'Comprobando tu Gmail…' : 'Preparando verificación…') : prepared ? 'Continuar con Google' : 'Preparar verificación con Google'}
            </button>
            {prepared && <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => { currentFlow.current?.dispose(); setAttempt(value => value + 1); setMessage(''); setError(''); }}>Cancelar verificación</button>}
            <div style={{ textAlign: 'center', marginTop: 16 }}><button type="button" className="btn btn-quiet btn-small" onClick={onGoMap}>Continuar navegando en el mapa</button></div>
          </div>
        )}
      </div>
    </div>
  );
};
