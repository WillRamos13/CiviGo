'use client';
import { useState } from 'react';
import Link from 'next/link';
import AuthGate from '@/components/AuthGate';
import { useAuth } from '@/components/AuthProvider';
import { post, errorMessage } from '@/lib/api';
function Verification() {
    const { usuario, refresh } = useAuth();
    const [codigo, setCodigo] = useState(''), [emailCode, setEmailCode] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [demo, setDemo] = useState(''), [emailDemo, setEmailDemo] = useState(''), [emailSent, setEmailSent] = useState(false), [busy, setBusy] = useState(false), [channel, setChannel] = useState('sms');
    const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); setMessage(''); try {
        await action();
    }
    catch (err) {
        setError(errorMessage(err));
    }
    finally {
        setBusy(false);
    } };
    return <>{error && <div className="notice notice-error" role="alert">{error}</div>}{message && <div className="notice notice-success" role="status">{message}</div>}<div className="card"><h2>Teléfono</h2><p className="muted">{usuario?.telefono}</p>{usuario?.telefonoVerificado ? <div className="notice notice-success">Tu teléfono está verificado. Ya puedes participar en la comunidad.</div> : <><p className="muted">Verifica tu teléfono para publicar reportes, confirmar incidentes y participar en chats.</p><div className="field"><label htmlFor="canal">Recibir código por</label><select id="canal" value={channel} onChange={e => setChannel(e.target.value)}><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select></div><button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { const data = await post<{
        modo?: string;
        codigoDemo?: string;
        mensaje?: string;
    }>('/users/phone/request', { canal: channel }); setDemo(data.codigoDemo || ''); setMessage(data.mensaje || 'Se solicitó el código de verificación.'); })}>Solicitar código</button>{demo && <div className="notice notice-warning" style={{ marginTop: 15 }}>Verificación de demostración local. No se envió un SMS real. Código de prueba: <strong>{demo}</strong>.</div>}<form style={{ marginTop: 20 }} onSubmit={e => { e.preventDefault(); void run(async () => { await post('/users/phone/verify', { codigo }); await refresh(); setMessage('Teléfono verificado correctamente.'); setDemo(''); }); }}><div className="field"><label htmlFor="codigo">Código recibido</label><input id="codigo" value={codigo} onChange={e => setCodigo(e.target.value)} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6}/></div><button className="btn btn-secondary" disabled={busy || codigo.length !== 6}>Verificar código</button></form></>}</div><div className="card"><h2>Correo electrónico</h2><p className="muted">{usuario?.correo}</p>{usuario?.correoVerificado ? <span className="badge">Correo verificado</span> : <><p className="muted">El correo permite recibir recordatorios sobre tus pruebas privadas y validar cambios de cuenta.</p><button className="btn btn-secondary" disabled={busy} onClick={() => run(async () => { const data = await post<{
        mensaje?: string;
        codigoDemo?: string;
    }>('/users/email/request'); setEmailDemo(data.codigoDemo || ''); setEmailSent(true); setMessage(data.mensaje || 'Solicitud de verificación enviada.'); })}>Solicitar código de correo</button>{emailDemo && <div className="notice notice-warning" style={{ marginTop: 15 }}>Correo de demostración local. No se envió un correo real. Código: <strong>{emailDemo}</strong>.</div>}{emailSent && <form style={{ marginTop: 20 }} onSubmit={e => { e.preventDefault(); void run(async () => { await post('/users/email/verify', { codigo: emailCode }); await refresh(); setMessage('Correo verificado correctamente.'); setEmailDemo(''); }); }}><div className="field"><label htmlFor="email-code">Código de correo</label><input id="email-code" value={emailCode} onChange={e => setEmailCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6}/></div><button className="btn btn-secondary" disabled={busy || emailCode.length !== 6}>Verificar correo</button></form>}</>}</div><Link href="/mapa" className="btn btn-primary">Ir al mapa</Link></>;
}
export default function Page() { return <div className="page" style={{ maxWidth: 680 }}><div className="page-heading"><span className="eyebrow">TU CUENTA</span><h1>Verificación de contactos</h1><p>Tu cuenta puede consultar rutas antes de verificar el teléfono.</p></div><AuthGate><Verification /></AuthGate></div>; }
