"use client";

import { useCallback, useEffect, useState, useRef, Fragment } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";

export function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "No se pudo completar la solicitud. Inténtalo nuevamente.";
}

export function useRemote<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const cache = useRef<{ path: string; data: T } | null>(null);
  const reload = useCallback(() => { setLoading(true); setError(''); setVersion(value => value + 1); }, []);
  useEffect(() => {
    let current = true, busy = false;
    const controller = new AbortController();
    async function read(background = false) {
      if (busy || !current) return;
      busy = true;
      if (!background) setLoading(true);
      try {
        const value = await api<T>(path, { signal: controller.signal });
        if (current) { cache.current = { path, data: value }; setData(value); setLoadedPath(path); setError(''); setRefreshError(''); }
      } catch (reason) {
        if (current) {
          setLoadedPath(path);
          if (cache.current?.path === path) setRefreshError(message(reason));
          else { setData(null); setError(message(reason)); }
        }
      } finally { busy = false; if (current) setLoading(false); }
    }
    const recover = () => { if (document.visibilityState === 'visible' && navigator.onLine) void read(true); };
    void read();
    const timer = setInterval(recover, 30000);
    window.addEventListener('online', recover);
    window.addEventListener('focus', recover);
    window.addEventListener('civigo:management-refresh', recover);
    document.addEventListener('visibilitychange', recover);
    return () => { current = false; controller.abort(); clearInterval(timer); window.removeEventListener('online', recover); window.removeEventListener('focus', recover); window.removeEventListener('civigo:management-refresh', recover); document.removeEventListener('visibilitychange', recover); };
  }, [path, version]);
  return { data: loadedPath === path ? data : null, error: loadedPath === path ? error : '', refreshError: loadedPath === path ? refreshError : '', loading: loading || loadedPath !== path, reload };
}

export interface PagedResult<T> { items: T[]; total: number; page: number; pageSize: number; pages: number; }
export function usePagedRemote<T>(path: string, options: { q?: string; estado?: string; limit?: number } = {}) {
  const { q = '', estado = '', limit = 50 } = options;
  const filterKey = JSON.stringify([path, q, estado, limit]);
  const [selection, select] = useState({ key: filterKey, page: 1 });
  const page = selection.key === filterKey ? selection.page : 1;
  const setPage = (next: number) => select({ key: filterKey, page: Math.max(1, next) });
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (q.trim()) params.set('q', q.trim());
  if (estado && estado !== 'TODOS') params.set('estado', estado);
  const remote = useRemote<PagedResult<T> | T[]>(path + '?' + params.toString());
  // Older backends can still return their legacy list while deployments roll over.
  const result = Array.isArray(remote.data) ? { items: remote.data, total: remote.data.length, page: 1, pageSize: limit, pages: 1 } : remote.data;
  return { ...remote, data: result?.items ?? null, total: result?.total ?? 0, page, pages: result?.pages ?? 1, setPage };
}
export function Pagination({ page, pages, total, onPage, disabled = false }: { page: number; pages: number; total: number; onPage: (page: number) => void; disabled?: boolean }) {
  return <nav aria-label="Paginación de resultados" className="flex flex-wrap items-center justify-between gap-3 my-4">
    <span className="muted text-sm">{total} resultados · Página {page} de {Math.max(1, pages)}</span>
    <div className="flex gap-2"><button type="button" className="btn btn-secondary" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>Anterior</button><button type="button" className="btn btn-secondary" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>Siguiente</button></div>
  </nav>;
}

export function Feedback({
  error,
  success,
}: {
  error?: string;
  success?: string;
}) {
  return (
    <>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="notice notice-success" role="status">
          {success}
        </p>
      )}
    </>
  );
}

export function RemoteStatus({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  if (loading)
    return (
      <p className="muted" role="status">
        Cargando información…
      </p>
    );
  if (error)
    return (
      <div className="notice notice-error" role="alert">
        <p>{error}</p>
        <button className="btn btn-secondary mt-3" onClick={retry}>
          Volver a intentar
        </button>
      </div>
    );
  return null;
}

export function ManagementGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { usuario, loading } = useAuth();
  if (loading)
    return (
      <div className="page">
        <p role="status">Comprobando acceso…</p>
      </div>
    );
  if (!usuario)
    return (
      <div className="page">
        <section className="card">
          <h1 className="text-xl font-bold">Ingresa para continuar</h1>
          <p className="muted my-3">
            Este espacio está reservado al personal de CiviGo.
          </p>
          <Link className="btn btn-primary" href="/ingresar">
            Iniciar sesión
          </Link>
        </section>
      </div>
    );
  if (usuario.bloqueado)
    return (
      <div className="page">
        <section className="card">
          <h1 className="text-xl font-bold">Cuenta restringida</h1>
          <p className="muted my-3">
            La cuenta está bloqueada y no puede registrar decisiones
            administrativas. Puedes solicitar revisión de tus reportes.
          </p>
          <Link className="btn btn-secondary" href="/mis-reportes">
            Consultar mis reportes
          </Link>
        </section>
      </div>
    );
  const role = usuario.rol.toUpperCase();
  if (role !== "AGENTE")
    return (
      <div className="page">
        <section className="card">
          <h1 className="text-xl font-bold">Acceso restringido</h1>
          <p className="muted my-3">
            Tu cuenta no tiene permisos para abrir este espacio.
          </p>
          <Link className="btn btn-secondary" href="/mapa">
            Volver al mapa
          </Link>
        </section>
      </div>
    );
  const accessKey = JSON.stringify([usuario.id, usuario.rol, usuario.distrito, usuario.tipoAgente, [...(usuario.permisos ?? [])].sort()]);
  return <Fragment key={accessKey}>{children}</Fragment>;
}

export function dateTime(value?: string | null) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Lima",
  }).format(date);
}

export function number(value: number | string | null | undefined) {
  return new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 }).format(
    Number(value ?? 0),
  );
}

const states: Record<string, string> = {
  PENDIENTE: "Pendiente",
  ACTIVO: "Activo",
  VALIDADO: "Validado",
  RESUELTO: "Resuelto",
  FALSO: "Declarado falso",
  RETIRADO: "Retirado",
  EXPIRADO: "Retirado por plazo",
  POR_EVALUAR: "Por evaluar",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  BLOQUEADO: "Bloqueado",
  ACEPTADA: "Aceptada",
  RECHAZADA: "Rechazada",
  SOLICITADO_DEMO: "Solicitado · demostración",
  APROBADO_DEMO: "Aprobado · demostración",
};
export function stateLabel(value: string) {
  return (
    states[value.toUpperCase()] ?? value.toLowerCase().replaceAll("_", " ")
  );
}
