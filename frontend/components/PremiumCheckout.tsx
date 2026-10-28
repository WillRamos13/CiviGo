"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";
import { api, post, errorMessage } from "@/lib/api";
type Catalog = {
  habilitado: boolean;
  precioCentimos: number;
  moneda: string;
  dias: number;
  modo: string;
};
type Order = {
  referencia: string;
  estado: string;
  centimos: number;
  moneda: string;
  dias: number;
  modo: string;
};
export default function PremiumCheckout() {
  const { usuario, refresh } = useAuth();
  const ownerId = usuario?.id;
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [order, setOrder] = useState<Order | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void api<Catalog>("/payments/catalog", { signal: c.signal })
      .then(setCatalog)
      .catch(() => {});
    return () => c.abort();
  }, []);
  useEffect(() => {
    if (!ownerId) return;
    let active = true;
    const c = new AbortController(),
      q = new URLSearchParams(location.search),
      ref = q.get("orden"),
      payment = q.get("payment_id") || q.get("collection_id");
    if (!ref || !/^[a-f0-9-]{36}$/i.test(ref)) return;
    const load = async () => {
      try {
        let result = await api<Order>(`/payments/orders/${ref}`, {
          signal: c.signal,
        });
        if (payment && /^\d{1,24}$/.test(payment))
          result = await post<Order>(
            `/payments/orders/${ref}/sync`,
            { paymentId: payment },
            { signal: c.signal },
          );
        if (active) {
          setOrder(result);
          if (result.estado === "approved") await refresh();
        }
      } catch (reason) {
        if (active) setError(errorMessage(reason));
      }
    };
    void load();
    return () => {
      active = false;
      c.abort();
    };
  }, [ownerId, refresh]);
  const buy = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let key = sessionStorage.getItem("civigo:checkout-key");
      if (!key) {
        key = crypto.randomUUID();
        sessionStorage.setItem("civigo:checkout-key", key);
      }
      const result = await post<{ url: string; referencia: string }>(
        "/payments/checkout",
        {},
        { headers: { "X-Idempotency-Key": key } },
      );
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        !(
          url.hostname === "mercadopago.com.pe" ||
          url.hostname.endsWith(".mercadopago.com.pe")
        )
      )
        throw new Error("No se pudo abrir el entorno seguro de pago.");
      sessionStorage.removeItem("civigo:checkout-key");
      window.location.assign(url.href);
    } catch (reason) {
      setError(errorMessage(reason));
      sessionStorage.removeItem("civigo:checkout-key");
      setBusy(false);
    }
  };
  const price = new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
  }).format((catalog?.precioCentimos ?? 590) / 100);
  return (
    <section className="card premium-checkout">
      <div>
        <h2>
          {price} <small>por {catalog?.dias ?? 30} días</small>
        </h2>
        <p>Pago único con Mercado Pago. Sin renovación automática.</p>
        <p className="muted">
          CiviGo no recibe ni guarda los datos de tu tarjeta.
        </p>
      </div>
      {order && (
        <p role="status" className="notice">
          {order.estado === "approved"
            ? order.modo === "test"
              ? "Prueba de pago aprobada. No se realizó un cobro real."
              : "Pago aprobado. Tus beneficios Premium ya están disponibles."
            : ["rejected", "cancelled", "ERROR"].includes(order.estado)
              ? "El pago no se completó. Puedes volver a intentarlo."
              : `Estado del pago: ${order.estado}. Los beneficios se activan después de la confirmación.`}
        </p>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {!usuario ? (
        <Link className="btn btn-primary" href="/ingresar">
          Ingresar para continuar
        </Link>
      ) : !usuario.correoVerificado ? (
        <Link className="btn btn-secondary" href="/verificar">
          Verificar Gmail
        </Link>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          disabled={!catalog?.habilitado || busy || usuario.premium}
          onClick={() => void buy()}
        >
          {busy
            ? "Preparando pago…"
            : usuario.premium
              ? "Premium activo"
              : catalog?.habilitado
                ? catalog.modo === "test"
                  ? "Probar pago · entorno de prueba"
                  : "Continuar a Mercado Pago"
                : "Pagos todavía no disponibles"}
        </button>
      )}
      {usuario?.premium && (
        <p className="muted">
          Tu cuenta ya tiene Premium activo. Consulta tus beneficios en Mi
          perfil.
        </p>
      )}
    </section>
  );
}
