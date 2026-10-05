'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { useAuth } from '@/components/AuthProvider';
import { api, post, ApiError, errorMessage, formatDate } from '@/lib/api';
import { GoogleEmailFlow, firebaseEmailConfig, googleEmailErrorMessage } from '@/lib/firebase-email';
import type { GoogleEmailChallenge } from '@/lib/firebase-email';

type PhoneConfig = {
    proveedor: 'whatsapp-manual' | 'twilio-verify';
    configurado: boolean;
    canales: ('sms' | 'whatsapp')[];
    demo: boolean;
};
type GoogleConfig = { configurado: boolean; projectId: string | null };
type ManualWhatsApp = { codigoManual: string; whatsappUrl: string; expiresAt: string };
type PhoneRequest = { modo?: string; codigoDemo?: string; mensaje?: string; codigoManual?: string; whatsappUrl?: string; expiresAt?: string };
const networkSignal = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(20000)]);

function manualWhatsApp(data: PhoneRequest): ManualWhatsApp {
    try {
        const url = new URL(data.whatsappUrl || '');
        if (data.modo !== 'whatsapp-manual' || !/^[A-F0-9]{24}$/.test(data.codigoManual || '') ||
            url.origin !== 'https://wa.me' || !/^\/[1-9]\d{7,14}$/.test(url.pathname) || url.username || url.password || url.hash ||
            !url.searchParams.get('text')?.includes(data.codigoManual!) || !data.expiresAt ||
            !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()) throw new Error();
        return { codigoManual: data.codigoManual!, whatsappUrl: url.href, expiresAt: data.expiresAt };
    } catch { throw new Error('No se pudo preparar el mensaje de WhatsApp. Inténtalo de nuevo.'); }
}

function ContactVerification() {
    const { usuario, refresh } = useAuth();
    const [codigo, setCodigo] = useState('');
    const [emailCode, setEmailCode] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [demo, setDemo] = useState('');
    const [emailDemo, setEmailDemo] = useState('');
    const [emailSent, setEmailSent] = useState(false);
    const [phoneSent, setPhoneSent] = useState(false);
    const [phoneDemo, setPhoneDemo] = useState(false);
    const [manual, setManual] = useState<ManualWhatsApp | null>(null);
    const [busy, setBusy] = useState(false);
    const [channel, setChannel] = useState<'sms' | 'whatsapp'>('whatsapp');
    const [phoneConfig, setPhoneConfig] = useState<PhoneConfig | null>(null);
    const [googleConfig, setGoogleConfig] = useState<GoogleConfig | null>(null);
    const [configLoading, setConfigLoading] = useState(true);
    const [googleLoading, setGoogleLoading] = useState(true);
    const [googleConsent, setGoogleConsent] = useState(false);
    const [googleStage, setGoogleStage] = useState<'prepare' | 'account' | 'retry'>('prepare');
    const googleFlow = useRef<GoogleEmailFlow | null>(null);
    const operation = useRef<AbortController | null>(null);
    const epoch = useRef(0);
    const lock = useRef(false);
    useEffect(() => {
        const current = ++epoch.current;
        const controller = new AbortController();
        void api<PhoneConfig>('/users/phone/config', { signal: networkSignal(controller.signal) }).then(config => {
            if (epoch.current !== current || controller.signal.aborted) return;
            if (!['whatsapp-manual', 'twilio-verify'].includes(config?.proveedor) || !Array.isArray(config.canales))
                throw new Error('La verificación telefónica no está disponible en este momento.');
            const channels = config.proveedor === 'whatsapp-manual' ? ['whatsapp' as const] : config.canales.filter(item => item === 'sms' || item === 'whatsapp');
            setPhoneConfig({ ...config, canales: channels });
            setChannel(channels[0] || 'whatsapp');
        }).catch(err => {
            if (!controller.signal.aborted && epoch.current === current) setError(errorMessage(err));
        }).finally(() => {
            if (!controller.signal.aborted && epoch.current === current) setConfigLoading(false);
        });
        void api<GoogleConfig>('/users/email/google/config', { signal: networkSignal(controller.signal) }).then(config => {
            if (epoch.current !== current || controller.signal.aborted) return;
            setGoogleConfig(config);
        }).catch(() => {
            // El código por correo sigue disponible si Google no está habilitado.
            if (!controller.signal.aborted && epoch.current === current) setGoogleConfig(null);
        }).finally(() => {
            if (!controller.signal.aborted && epoch.current === current) setGoogleLoading(false);
        });
        return () => {
            epoch.current = current + 1;
            controller.abort(); operation.current?.abort();
            googleFlow.current?.dispose(); googleFlow.current = null;
        };
    }, []);

    const run = async (action: (signal: AbortSignal) => Promise<void>, google = false) => {
        if (lock.current) return;
        const current = epoch.current;
        const controller = new AbortController();
        operation.current = controller; lock.current = true;
        setBusy(true); setError(''); setMessage('');
        try { await action(controller.signal); }
        catch (err) {
            if (!controller.signal.aborted && epoch.current === current) {
                if (err instanceof DOMException && err.name === 'TimeoutError') setError('El servicio tardó demasiado en responder. Inténtalo de nuevo.');
                else setError(google && !(err instanceof ApiError) ? googleEmailErrorMessage(err) : errorMessage(err));
            }
        } finally {
            if (epoch.current === current) { operation.current = null; lock.current = false; setBusy(false); }
        }
    };

    const manualProvider = phoneConfig?.proveedor === 'whatsapp-manual';
    const phoneAvailable = !!phoneConfig && phoneConfig.canales.length > 0 && (phoneConfig.configurado || phoneConfig.demo);
    const publicConfig = firebaseEmailConfig();
    const googleAvailable = !!googleConfig?.configurado && !!publicConfig && publicConfig.projectId === googleConfig.projectId;

    const requestPhone = () => run(async signal => {
        if (!phoneConfig || !phoneAvailable) return;
        const data = await post<PhoneRequest>('/users/phone/request', { canal: manualProvider ? 'whatsapp' : channel }, { signal: networkSignal(signal) });
        if (signal.aborted) return;
        setCodigo('');
        if (data.modo === 'demo') {
            setManual(null); setDemo(data.codigoDemo || ''); setPhoneSent(true); setPhoneDemo(true);
            setMessage(data.mensaje || 'Código local de demostración preparado.');
        } else if (manualProvider) {
            setManual(manualWhatsApp(data)); setPhoneSent(false); setDemo('');
            setPhoneDemo(false);
            setMessage('Mensaje preparado. Envíalo desde el teléfono registrado para que un administrador lo revise.');
        } else {
            setManual(null); setDemo(data.codigoDemo || ''); setPhoneSent(true); setPhoneDemo(false);
            setMessage(data.mensaje || 'Se solicitó el código de verificación.');
        }
    });

    const verifyGoogle = () => run(async signal => {
        if (!googleAvailable || !googleConsent || !usuario) return;
        const flow = googleFlow.current || new GoogleEmailFlow(publicConfig, googleConfig?.projectId);
        googleFlow.current = flow;
        try {
            if (!flow.prepared) {
                await flow.prepare(() => post<GoogleEmailChallenge>('/users/email/google/request', {}, { signal: networkSignal(signal) }));
                if (!signal.aborted) setMessage('Solicitud preparada. Pulsa Elegir mi cuenta de Google para abrir la ventana de verificación.');
                return;
            }
            // El segundo clic abre la ventana inmediatamente, con el SDK y la
            // solicitud ya preparados, para conservar la activación del navegador.
            await flow.verify(usuario.correo, proof => post('/users/email/google/verify', proof, { signal: networkSignal(signal) }));
            if (signal.aborted) return;
            setMessage('Correo verificado correctamente con Google.');
            setEmailDemo(''); setEmailSent(false);
            await refresh();
        } finally {
            if (!signal.aborted) setGoogleStage(flow.hasProof ? 'retry' : flow.prepared ? 'account' : 'prepare');
        }
    }, true);

    return <>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {message && <div className="notice notice-success" role="status">{message}</div>}
        <div className="card">
            <h2>Teléfono</h2><p className="muted">{usuario?.telefono}</p>
            {usuario?.telefonoVerificado ? <div className="notice notice-success">Tu teléfono está verificado. Ya puedes participar en la comunidad.</div> : <>
                <p className="muted">Verifica tu teléfono para publicar reportes, confirmar incidentes y participar en chats.</p>
                {configLoading ? <p className="muted" role="status">Comprobando los canales disponibles…</p> : !phoneAvailable && <div className="notice notice-warning">La verificación telefónica no está disponible en este momento.</div>}
                {manualProvider && !(phoneConfig?.demo || phoneDemo) ? <p className="muted">Por ahora la revisión es manual por WhatsApp. Prepararemos un mensaje para que lo envíes desde el número registrado; un administrador comprobará el remitente y aprobará tu teléfono.</p> : !manualProvider && phoneConfig && <div className="field"><label htmlFor="canal">Recibir código por</label><select id="canal" value={channel} disabled={busy} onChange={e => setChannel(e.target.value as 'sms' | 'whatsapp')}>
                    {phoneConfig.canales.map(item => <option key={item} value={item}>{item === 'sms' ? 'SMS' : 'WhatsApp'}</option>)}
                </select></div>}
                <div className="actions"><button className="btn btn-primary" disabled={busy || configLoading || !phoneAvailable} onClick={() => void requestPhone()}>{phoneConfig?.demo || phoneDemo ? 'Solicitar código de prueba' : manualProvider ? manual ? 'Preparar otro mensaje' : 'Preparar mensaje de WhatsApp' : phoneSent ? 'Solicitar otro código' : 'Solicitar código'}</button>
                {manualProvider && !phoneDemo && !phoneConfig?.demo && <button className="btn btn-secondary" disabled={busy} onClick={() => void run(async signal => { await refresh(); if (!signal.aborted) setMessage('Estado actualizado. Si todavía aparece pendiente, espera la revisión del administrador.'); })}>Consultar aprobación</button>}</div>
                {manualProvider && !phoneDemo && manual && <div className="notice notice-warning" style={{ marginTop: 16 }}>
                    <p><strong>Pendiente de revisión</strong></p>
                    <p>Envía el mensaje desde <strong>{usuario?.telefono}</strong>. Abrir WhatsApp no verifica el teléfono automáticamente.</p>
                    <p>Código de tu solicitud: <strong style={{ overflowWrap: 'anywhere' }}>{manual.codigoManual}</strong></p>
                    <p>Vence el {formatDate(manual.expiresAt)}.</p>
                    <div className="actions"><a className="btn btn-primary btn-small" href={manual.whatsappUrl} target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a></div>
                </div>}
                {demo && <div className="notice notice-warning" style={{ marginTop: 15 }}>Verificación de demostración local. No se envió ningún mensaje real. Código de prueba: <strong>{demo}</strong>.</div>}
                {(!manualProvider || phoneDemo) && phoneSent && <form style={{ marginTop: 20 }} onSubmit={e => { e.preventDefault(); void run(async signal => {
                    await post('/users/phone/verify', { codigo }, { signal: networkSignal(signal) });
                    if (signal.aborted) return;
                    setMessage('Teléfono verificado correctamente.'); setPhoneSent(false); setDemo(''); setCodigo(''); await refresh();
                }); }}><div className="field"><label htmlFor="codigo">Código recibido</label><input id="codigo" value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} /></div><button className="btn btn-secondary" disabled={busy || codigo.length !== 6}>Verificar código</button></form>}
            </>}
        </div>
        <div className="card"><h2>Correo electrónico</h2><p className="muted">{usuario?.correo}</p>
            {usuario?.correoVerificado ? <div className="notice notice-success">Tu correo está verificado.</div> : <>
                <p className="muted">Google puede comprobar el correo de tu cuenta sin enviar un código. Elige la misma dirección que registraste en CiviGo; tu sesión de CiviGo se mantiene.</p>
                {googleLoading ? <p className="muted" role="status">Comprobando la verificación con Google…</p> : !googleAvailable && <p className="muted">La verificación con Google todavía no está disponible en esta página.</p>}
                <label className="inline-checkbox"><input type="checkbox" checked={googleConsent} disabled={busy} onChange={e => setGoogleConsent(e.target.checked)} /><span>Acepto que Google compruebe mi dirección de correo para verificarla en CiviGo.</span></label>
                <button className="btn btn-primary" style={{ marginTop: 16 }} disabled={busy || googleLoading || !googleAvailable || !googleConsent} onClick={() => void verifyGoogle()}>{googleStage === 'account' ? 'Elegir mi cuenta de Google' : googleStage === 'retry' ? 'Reintentar la verificación' : 'Verificar con Google'}</button>
                <p className="muted" style={{ marginTop: 20 }}>También puedes solicitar un código por correo, si el servicio está habilitado. El correo sirve para recordatorios y cambios de cuenta.</p>
                <button className="btn btn-secondary" disabled={busy} onClick={() => void run(async signal => {
                    const data = await post<{ mensaje?: string; codigoDemo?: string }>('/users/email/request', {}, { signal: networkSignal(signal) });
                    if (signal.aborted) return;
                    setEmailDemo(data.codigoDemo || ''); setEmailSent(true); setMessage(data.mensaje || 'Solicitud de verificación enviada.');
                })}>Solicitar código de correo</button>
                {emailDemo && <div className="notice notice-warning" style={{ marginTop: 15 }}>Correo de demostración local. No se envió un correo real. Código: <strong>{emailDemo}</strong>.</div>}
                {emailSent && <form style={{ marginTop: 20 }} onSubmit={e => { e.preventDefault(); void run(async signal => {
                    await post('/users/email/verify', { codigo: emailCode }, { signal: networkSignal(signal) });
                    if (signal.aborted) return;
                    setMessage('Correo verificado correctamente.'); setEmailDemo(''); await refresh();
                }); }}><div className="field"><label htmlFor="email-code">Código de correo</label><input id="email-code" value={emailCode} onChange={e => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} /></div><button className="btn btn-secondary" disabled={busy || emailCode.length !== 6}>Verificar correo</button></form>}
            </>}
        </div><Link href="/mapa" className="btn btn-primary">Ir al mapa</Link>
    </>;
}

function Verification() {
    const { usuario } = useAuth();
    // Una cuenta o contacto diferente empieza un flujo nuevo y cancela el anterior.
    return <ContactVerification key={`${usuario?.id}:${usuario?.telefono}:${usuario?.correo}`} />;
}

export default function Page() {
    return <div className="page" style={{ maxWidth: 680 }}><div className="page-heading"><span className="eyebrow">TU CUENTA</span><h1>Verificación de contactos</h1><p>Tu cuenta puede consultar rutas antes de verificar el teléfono.</p></div><AuthGate><Verification /></AuthGate></div>;
}
