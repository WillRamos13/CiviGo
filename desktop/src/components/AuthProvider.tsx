import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { unwrap, ApiError } from '@/lib/api';
import type { Usuario } from '@/lib/types';
type Auth = { usuario: Usuario | null; loading: boolean; connectionError: string; login: (correo: string, password: string) => Promise<void>; refresh: () => Promise<void>; logout: () => Promise<void> };
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const revision = useRef(0);
  const operation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try { const user = unwrap(await window.civigoDesktop.session()); if (current === revision.current) { setUsuario(user); setConnectionError(''); } }
    catch (error) { if (current === revision.current) {
      if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) setConnectionError('No se pudo comprobar la conexión. Tus cambios sin guardar se conservan; reintentaremos automáticamente.');
      else { setUsuario(null); setConnectionError(''); }
    } }
    finally { if (current === revision.current) setLoading(false); }
  }, []);
  const login = useCallback(async (correo: string, password: string) => {
    const current = ++operation.current; revision.current++;
    const user = unwrap(await window.civigoDesktop.login({ correo, password }));
    if (current === operation.current) { revision.current++; setUsuario(user); setLoading(false); }
  }, []);
  const logout = useCallback(async () => {
    const current = ++operation.current; revision.current++; setUsuario(null);
    try { unwrap(await window.civigoDesktop.logout()); }
    finally { if (current === operation.current) { revision.current++; setUsuario(null); setLoading(false); } }
  }, []);
  useEffect(() => {
    const unsubscribe = window.civigoDesktop.onSession(user => { revision.current++; setUsuario(user); setLoading(false); setConnectionError(''); });
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60000);
    const recover = () => { void refresh(); };
    window.addEventListener?.('online', recover); window.addEventListener?.('focus', recover);
    return () => { revision.current++; operation.current++; clearInterval(timer); unsubscribe(); window.removeEventListener?.('online', recover); window.removeEventListener?.('focus', recover); };
  }, [refresh]);
  return <Context.Provider value={{ usuario, loading, connectionError, login, refresh, logout }}>{children}</Context.Provider>;
}
export function useAuth() { const auth = useContext(Context); if (!auth) throw new Error('Falta el proveedor de sesión.'); return auth; }
