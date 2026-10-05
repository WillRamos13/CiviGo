"use client";

import { useCallback, useEffect, useState, Fragment } from "react";
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => {
    setLoading(true);
    setError("");
    setVersion((value) => value + 1);
  }, []);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal })
      .then((value) => {
        if (current) {
          setData(value);
          setLoadedPath(path);
          setError("");
        }
      })
      .catch((reason: unknown) => {
        if (current) {
          setLoadedPath(path);
          setError(message(reason));
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [path, version]);
  return {
    data: loadedPath === path ? data : null,
    error: loadedPath === path ? error : "",
    loading: loading || loadedPath !== path,
    reload,
  };
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
