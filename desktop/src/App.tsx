import { useState } from 'react';
import { ShieldCheck, LogOut, Moon, Sun } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import ManagementDashboard from '@/components/management/ManagementDashboard';
import { version as appVersion } from '../package.json';
function Login() {
  const { login } = useAuth();
  const [correo, setCorreo] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <main className="login-page"><section className="card login-card"><img className="login-logo" src="/civigo-logo.jpeg" alt="CiviGo"/><span className="eyebrow">APLICACIÓN DE ESCRITORIO</span><h1>Administración de CiviGo</h1><p className="muted">Ingresa con tu cuenta administradora para revisar y gestionar la comunidad.</p><form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { await login(correo, password); }
    catch (error) { setError(error instanceof Error ? error.message : 'No se pudo iniciar sesión.'); }
    finally { setPassword(''); setBusy(false); }
  }}><div className="field"><label htmlFor="correo">Correo electrónico</label><input id="correo" type="email" value={correo} onChange={e => setCorreo(e.target.value)} autoComplete="username" required maxLength={254} disabled={busy}/></div><div className="field"><label htmlFor="password">Contraseña</label><input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required maxLength={128} disabled={busy}/></div>{error && <div className="notice notice-error" role="alert">{error}</div>}<button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Comprobando acceso…' : 'Ingresar a administración'}</button></form><p className="muted text-sm mt-4"><ShieldCheck size={15}/> La sesión se guarda sólo mientras la aplicación está abierta.</p><p className="muted text-sm mt-4">Versión {appVersion}</p></section></main>;
}
export default function App() {
  const { usuario, loading, logout } = useAuth();
  const [dark, setDark] = useState(false), [busy, setBusy] = useState(false);
  if (loading) return <main className="login-page"><p role="status">Comprobando acceso…</p></main>;
  if (!usuario) return <Login/>;
  return <><header className="desktop-header"><div className="desktop-brand"><img src="/civigo-logo.jpeg" alt="CiviGo"/><div><strong>CiviGo Administración</strong><span>{usuario.nickname} · v{appVersion}</span></div></div><div className="actions"><button className="icon-btn" aria-label={dark ? 'Activar modo claro' : 'Activar modo oscuro'} onClick={() => { setDark(!dark); document.documentElement.dataset.theme = dark ? 'light' : 'dark'; }}>{dark ? <Sun size={20}/> : <Moon size={20}/>}</button><button className="btn btn-secondary" disabled={busy} onClick={async () => { setBusy(true); try { await logout(); } finally { setBusy(false); } }}><LogOut size={16}/>{busy ? 'Cerrando…' : 'Cerrar sesión'}</button></div></header><main id="contenido" key={usuario.id}><ManagementDashboard administrator/></main></>;
}
