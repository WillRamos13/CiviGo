'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { useAuth } from '@/components/AuthProvider';
import { api, post, ApiError, errorMessage } from '@/lib/api';
import { GoogleEmailFlow, firebaseEmailConfig, googleEmailErrorMessage } from '@/lib/firebase-email';
import type { GoogleEmailChallenge } from '@/lib/firebase-email';

type GoogleConfig = { configurado: boolean; projectId: string | null };
const networkSignal = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(20000)]);

function GmailVerification() {
    const { usuario, refresh } = useAuth();
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [googleConfig, setGoogleConfig] = useState<GoogleConfig | null>(null);
    const [googleLoading, setGoogleLoading] = useState(true);
    const [consent, setConsent] = useState(false);
    const [stage, setStage] = useState<'prepare' | 'account' | 'retry'>('prepare');
    const flow = useRef<GoogleEmailFlow | null>(null);
    const operation = useRef<AbortController | null>(null);
    const epoch = useRef(0);
    const lock = useRef(false);

    useEffect(() => {
        const current = ++epoch.current;
        const controller = new AbortController();
        void api<GoogleConfig>('/users/email/google/config', { signal: networkSignal(controller.signal) }).then(config => {
            if (epoch.current === current && !controller.signal.aborted) setGoogleConfig(config);
        }).catch(() => {
            if (epoch.current === current && !controller.signal.aborted) setGoogleConfig(null);
        }).finally(() => {
            if (epoch.current === current && !controller.signal.aborted) setGoogleLoading(false);
        });
        return () => {
            epoch.current = current + 1;
            controller.abort(); operation.current?.abort();
            flow.current?.dispose(); flow.current = null;
        };
    }, []);

    const publicConfig = firebaseEmailConfig();
    const available = !!googleConfig?.configurado && !!publicConfig && publicConfig.projectId === googleConfig.projectId;
    const verify = async () => {
        if (lock.current || !available || !consent || !usuario) return;
        const current = epoch.current;
        const controller = new AbortController();
        operation.current = controller; lock.current = true;
        setBusy(true); setError(''); setMessage('');
        const currentFlow = flow.current || new GoogleEmailFlow(publicConfig, googleConfig?.projectId);
        flow.current = currentFlow;
        try {
            if (!currentFlow.prepared) {
                await currentFlow.prepare(() => post<GoogleEmailChallenge>('/users/email/google/request', {}, { signal: networkSignal(controller.signal) }));
                if (!controller.signal.aborted) setMessage('Solicitud preparada. Pulsa Elegir mi cuenta de Google y selecciona el Gmail que registraste.');
                return;
            }
            // El segundo clic abre la ventana sin una petición de red previa.
            await currentFlow.verify(usuario.correo, proof => post('/users/email/google/verify', proof, { signal: networkSignal(controller.signal) }));
            if (controller.signal.aborted) return;
            setMessage('Gmail verificado correctamente. Ya puedes participar en CiviGo.');
            await refresh();
        } catch (failure) {
            if (epoch.current === current && !controller.signal.aborted) {
                if (failure instanceof DOMException && failure.name === 'TimeoutError') setError('El servicio tardó demasiado en responder. Inténtalo de nuevo.');
                else setError(failure instanceof ApiError ? errorMessage(failure) : googleEmailErrorMessage(failure));
            }
        } finally {
            if (epoch.current === current && !controller.signal.aborted) {
                setStage(currentFlow.hasProof ? 'retry' : currentFlow.prepared ? 'account' : 'prepare');
                operation.current = null; lock.current = false; setBusy(false);
            }
        }
    };

    return <>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {message && <div className="notice notice-success" role="status">{message}</div>}
        <div className="card"><h2>Tu correo</h2><p className="muted">{usuario?.correo}</p>
            {usuario?.correoVerificado ? <div className="notice notice-success">Tu correo está verificado. {usuario.bloqueado ? 'Tu cuenta tiene una restricción de participación. Puedes solicitar revisión en Mis reportes.' : 'Puedes publicar reportes, confirmar incidentes y conversar.'}</div> : <>
                <p className="muted">Elige la misma dirección Gmail que registraste en CiviGo. Google comprobará que puedes acceder a ella; tu sesión de CiviGo se mantiene.</p>
                {googleLoading ? <p className="muted" role="status">Comprobando la verificación con Google…</p> : !available && <div className="notice notice-warning">La verificación con Google todavía no está disponible en esta página.</div>}
                <label className="inline-checkbox"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>Acepto que Google compruebe mi dirección Gmail para verificarla en CiviGo.</span></label>
                <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={busy || googleLoading || !available || !consent} onClick={() => void verify()}>{busy ? 'Procesando…' : stage === 'account' ? 'Elegir mi cuenta de Google' : stage === 'retry' ? 'Reintentar la verificación' : 'Verificar con Google'}</button>
            </>}
        </div>
        <Link href="/mapa" className="btn btn-primary">Ir al mapa</Link>
    </>;
}

function Verification() {
    const { usuario } = useAuth();
    return <GmailVerification key={`${usuario?.id}:${usuario?.correo}`} />;
}

export default function Page() {
    return <div className="page" style={{ maxWidth: 680 }}><div className="page-heading"><span className="eyebrow">TU CUENTA</span><h1>Verifica tu Gmail</h1><p>Tu cuenta puede consultar rutas antes de verificar el correo. Para participar, comprueba tu Gmail con Google.</p></div><AuthGate><Verification /></AuthGate></div>;
}
