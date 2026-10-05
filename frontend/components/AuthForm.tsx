'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { post, errorMessage, ApiError } from '@/lib/api';
import { useAuth } from './AuthProvider';
export default function AuthForm({ register = false }: {
    register?: boolean;
}) {
    const router = useRouter(), { refresh, prepareLogin } = useAuth();
    const [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const submit = async (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); setBusy(true); setError(''); const form = new FormData(e.currentTarget), values = Object.fromEntries(form); try {
        await prepareLogin();
        await post(`/users/${register ? 'register' : 'login'}`, values);
        await refresh();
        router.push(register ? '/verificar' : '/mapa');
    }
    catch (err) {
        if (!register && err instanceof ApiError && err.code === 'ACCOUNT_BLOCKED') {
            await refresh();
            router.push('/mis-reportes');
            return;
        }
        setError(errorMessage(err));
    }
    finally {
        setBusy(false);
    } };
    return <div className="page auth-page"><span className="eyebrow">COMUNIDAD CIVIGO</span><div className="card" style={{ marginTop: 12 }}><h1>{register ? 'Tu ciudad necesita tu voz.' : 'Qué bueno verte de nuevo.'}</h1><p className="muted">{register ? 'Crea tu cuenta y empieza a recorrer Ica con más información.' : 'Ingresa a tu cuenta para ver tus reportes y recorridos.'}</p>{error && <div className="notice notice-error" role="alert">{error}</div>}<form onSubmit={submit}>{register && <><div className="grid-2"><div className="field"><label htmlFor="nombre">Nombres</label><input id="nombre" name="nombre" autoComplete="given-name" required maxLength={80}/></div><div className="field"><label htmlFor="apellidos">Apellidos</label><input id="apellidos" name="apellidos" autoComplete="family-name" required maxLength={100}/></div></div><div className="field"><label htmlFor="nickname">Nickname público</label><input id="nickname" name="nickname" autoComplete="username" minLength={3} maxLength={30} pattern="[A-Za-z0-9_]+" required/><small>La comunidad verá este nombre. Usa letras, números y guion bajo.</small></div></>}<div className="field"><label htmlFor="correo">{register ? 'Correo Gmail' : 'Correo electrónico'}</label><input id="correo" type="email" name="correo" autoComplete="email" pattern={register ? '[^\\s@]+@[Gg][Mm][Aa][Ii][Ll]\\.[Cc][Oo][Mm]' : undefined} required maxLength={254}/>{register && <small>Usa tu dirección @gmail.com. La comprobarás con Google para participar.</small>}</div>{register && <><div className="field"><label htmlFor="telefono">Teléfono de contacto</label><input id="telefono" name="telefono" type="tel" autoComplete="tel" defaultValue="+51" required pattern="\+[0-9]{8,15}"/><small>Es un dato privado. Incluye el código de país, por ejemplo +51987654321.</small></div><div className="field"><label htmlFor="fechaNacimiento">Fecha de nacimiento</label><input id="fechaNacimiento" name="fechaNacimiento" type="date" required/><small>Edad mínima para registrarse: 12 años. Este dato es privado.</small></div></>}<div className="field"><label htmlFor="password">Contraseña</label><input id="password" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 10 : 1} maxLength={128} required/>{register && <small>Al menos 10 caracteres. Evita reutilizar una contraseña de otra cuenta.</small>}</div>{register && <label className="inline-checkbox" style={{ marginBottom: 20 }}><input type="checkbox" required/><span>Entiendo que CiviGo está en piloto, que mis datos personales son privados y que los reportes deben describir hechos reales.</span></label>}<button className="btn btn-primary" disabled={busy} style={{ width: '100%' }}>{busy ? 'Procesando…' : register ? 'Crear mi cuenta' : 'Iniciar sesión'}</button></form><p style={{ fontSize: 12, marginTop: 20, marginBottom: 0 }}>{register ? '¿Ya tienes cuenta?' : '¿Primera vez en CiviGo?'} <Link href={register ? '/ingresar' : '/registro'} style={{ color: 'var(--brand)', fontWeight: 700 }}>{register ? 'Inicia sesión' : 'Crea tu cuenta'}</Link></p></div></div>;
}
