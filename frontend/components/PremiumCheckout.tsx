"use client";
import { useEffect, useState, useRef } from "react";
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
  const { usuario } = useAuth();
  return <AccountCheckout key={usuario?.id ?? "visitor"} />;
}
function AccountCheckout() {
  const { usuario, refresh } = useAuth();
  const ownerId = usuario?.id;
  const owner = useRef(ownerId);
  const buyRequest = useRef<AbortController | null>(null);
  const [checkoutLink, setCheckoutLink] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0),
    [catalogBusy, setCatalogBusy] = useState(true);
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [order, setOrder] = useState<Order | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void api<Catalog>("/payments/catalog", { signal: c.signal })
      .then(setCatalog)
      .catch((reason) => {
        if (!c.signal.aborted) setError(errorMessage(reason));
      })
      .finally(() => {
        if (!c.signal.aborted) setCatalogBusy(false);
      });
    return () => c.abort();
  }, [catalogRevision]);
  useEffect(
    () => () => {
      buyRequest.current?.abort();
      buyRequest.current = null;
    },
    [],
  );
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
    if (busy || buyRequest.current || !ownerId) return;
    const controller = new AbortController(),
      buyer = ownerId;
    buyRequest.current = controller;
    setBusy(true);
    setError("");
    try {
      const storageKey = `civigo:checkout-key:${buyer}`;
      let key: string | null = null;
      try {
        key = sessionStorage.getItem(storageKey);
      } catch {}
      if (!key) {
        key = crypto.randomUUID();
        try {
          sessionStorage.setItem(storageKey, key);
        } catch {}
      }
      const result = await post<{ url: string; referencia: string }>(
        "/payments/checkout",
        {},
        { headers: { "X-Idempotency-Key": key }, signal: controller.signal },
      );
      if (owner.current !== buyer || controller.signal.aborted) return;
      const url = new URL(result.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        !(
          url.hostname === "mercadopago.com.pe" ||
          url.hostname.endsWith(".mercadopago.com.pe") ||
          url.hostname === "mercadopago.com" ||
          url.hostname.endsWith(".mercadopago.com")
        )
      )
        throw new Error("No se pudo abrir el entorno seguro de pago.");
      setCheckoutLink(url.href);
      setBusy(false);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
      window.location.assign(url.href);
    } catch (reason) {
      if (owner.current !== buyer || controller.signal.aborted) return;
      setError(errorMessage(reason));
      try {
        sessionStorage.removeItem(`civigo:checkout-key:${buyer}`);
      } catch {}
      setBusy(false);
    } finally {
      if (buyRequest.current === controller) buyRequest.current = null;
    }
  };
  const price = new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
  }).format((catalog?.precioCentimos ?? 100) / 100);
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
      {checkoutLink && (
        <p role="status">
          Pago preparado.{" "}
          <a className="btn btn-primary" href={checkoutLink}>
            Abrir Mercado Pago
          </a>{" "}<button type="button" className="btn btn-secondary" onClick={()=>{setCheckoutLink('');setError('');setOrder(null);setCatalogBusy(true);setCatalogRevision(value=>value+1);}}>Preparar otro enlace</button>
        </p>
      )}
      {!catalog && !catalogBusy && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setCatalogBusy(true);
            setError("");
            setCatalogRevision((value) => value + 1);
          }}
        >
          Reintentar conexión de pagos
        </button>
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
          disabled={
            !catalog?.habilitado || busy || usuario.premium || !!checkoutLink
          }
          onClick={() => void buy()}
        >
          {catalogBusy
            ? "Consultando pagos…"
            : checkoutLink
              ? "Pago preparado"
              : busy
                ? "Preparando pago…"
                : usuario.premium
                  ? "Premium activo"
                  : catalog?.habilitado
                    ? "Continuar a Mercado Pago"
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
