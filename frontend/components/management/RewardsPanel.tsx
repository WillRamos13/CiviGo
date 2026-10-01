"use client";

import { useState } from "react";
import AuthGate from "@/components/AuthGate";
import { useAuth } from "@/components/AuthProvider";
import { api } from "@/lib/api";
import {
  dateTime,
  Feedback,
  message,
  number,
  RemoteStatus,
  stateLabel,
  useRemote,
} from "./common";

interface Reward {
  id: number;
  nombre: string;
  descripcion: string;
  costoMonedas: number;
  stock: number;
  activo: boolean;
}
interface Redemption {
  id: number;
  recompensa: { nombre: string };
  estado: string;
  costoMonedas: number;
  creadoEn: string;
  nota?: string | null;
}
interface RewardsData {
  monedas: number;
  recompensas: Reward[];
  canjes: Redemption[];
}

function RewardsContent() {
  const { refresh } = useAuth();
  const { data, loading, error, reload } =
    useRemote<RewardsData>("/recompensas");
  const [selected, setSelected] = useState<Reward | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");
  async function redeem() {
    if (!selected || pending) return;
    setPending(true);
    setFailure("");
    setSuccess("");
    try {
      await api(`/recompensas/${selected.id}/canjear`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setSuccess(
        `Solicitud de demostración para «${selected.nombre}» registrada. Puedes consultar su estado en tus canjes.`,
      );
      setSelected(null);
      reload();
      await refresh();
    } catch (reason: unknown) {
      setFailure(message(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <section className="card mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="muted">Tus monedas disponibles</p>
          <p className="text-3xl font-bold brand-text mt-1">
            {data ? number(data.monedas) : "—"}
          </p>
        </div>
        <p className="max-w-lg muted">
          Las monedas son acumulables. Los canjes del piloto son una
          demostración y no implican una entrega real ni un pago.
        </p>
      </section>
      <Feedback error={failure} success={success} />
      <RemoteStatus loading={loading} error={error} retry={reload} />
      {!loading && !error && data && (
        <>
          <h2 className="text-xl font-bold mt-6 mb-4">
            Catálogo de demostración
          </h2>
          {data.recompensas.filter((reward) => reward.activo).length === 0 ? (
            <section className="card">
              <p className="font-medium">
                Todavía no hay recompensas disponibles.
              </p>
              <p className="muted mt-2">
                Los productos y cupones aparecerán cuando el administrador
                habilite el catálogo.
              </p>
            </section>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {data.recompensas
                .filter((reward) => reward.activo)
                .map((reward) => (
                  <article key={reward.id} className="card flex flex-col">
                    <span className="badge self-start">Demostración</span>
                    <h3 className="font-bold text-lg mt-3">{reward.nombre}</h3>
                    <p className="muted mt-2 flex-1">{reward.descripcion}</p>
                    <p className="font-semibold mt-4">
                      {number(reward.costoMonedas)} monedas
                    </p>
                    <p className="muted text-sm mt-1">
                      {reward.stock > 0
                        ? `${reward.stock} disponibles`
                        : "Sin stock"}
                    </p>
                    <button
                      className="btn btn-primary mt-4"
                      disabled={
                        reward.stock < 1 ||
                        Number(data.monedas) < Number(reward.costoMonedas) ||
                        pending
                      }
                      onClick={() => {
                        setSelected(reward);
                        setFailure("");
                      }}
                    >
                      {reward.stock < 1
                        ? "Sin stock"
                        : Number(data.monedas) < Number(reward.costoMonedas)
                          ? "Monedas insuficientes"
                          : "Solicitar canje"}
                    </button>
                  </article>
                ))}
            </div>
          )}
          {selected && (
            <section
              className="card mt-5 brand-border"
              aria-labelledby="confirm-reward"
            >
              <h2 id="confirm-reward" className="text-lg font-bold">
                Solicitar «{selected.nombre}»
              </h2>
              <p className="mt-2">
                Se reservarán {number(selected.costoMonedas)} monedas al
                registrar la solicitud. Si se rechaza, volverán a tu saldo.
              </p>
              <p className="muted mt-2">
                Este es un canje de demostración, sujeto a revisión del
                administrador.
              </p>
              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  className="btn btn-primary"
                  disabled={pending}
                  onClick={redeem}
                >
                  {pending ? "Registrando…" : "Confirmar solicitud"}
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={pending}
                  onClick={() => setSelected(null)}
                >
                  Cancelar
                </button>
              </div>
            </section>
          )}
          <section className="card mt-7">
            <h2 className="font-bold text-xl mb-4">Mis canjes</h2>
            {data.canjes.length === 0 ? (
              <p className="muted">Aún no has solicitado canjes.</p>
            ) : (
              <div className="divide-y">
                {data.canjes.map((redemption) => (
                  <article
                    key={redemption.id}
                    className="py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex flex-wrap justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">
                          {redemption.recompensa.nombre}
                        </h3>
                        <p className="muted text-sm mt-1">
                          {dateTime(redemption.creadoEn)} ·{" "}
                          {number(redemption.costoMonedas)} monedas
                        </p>
                      </div>
                      <span className="badge self-start">
                        {stateLabel(redemption.estado)}
                      </span>
                    </div>
                    {redemption.nota && (
                      <p className="muted mt-2">{redemption.nota}</p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
export default function RewardsPanel() {
  return (
    <div className="page max-w-6xl">
      <div className="page-heading">
        <div>
          <span className="badge">Piloto de CiviGo</span>
          <h1 className="mt-3">Recompensas</h1>
          <p className="muted">
            Consulta tus monedas y el estado de tus solicitudes.
          </p>
        </div>
      </div>
      <AuthGate>
        <RewardsContent />
      </AuthGate>
    </div>
  );
}
