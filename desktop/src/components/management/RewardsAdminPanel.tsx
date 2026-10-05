
import { useState } from "react";
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
  id?: number;
  nombre: string;
  descripcion: string;
  costoMonedas: number;
  stock: number;
  activo: boolean;
}
interface Redemption {
  id: number;
  recompensa: { nombre: string };
  usuario: { nickname?: string; nombreUsuario?: string };
  estado: string;
  costoMonedas: number;
  creadoEn: string;
}
const newReward: Reward = {
  nombre: "",
  descripcion: "",
  costoMonedas: 50,
  stock: 0,
  activo: true,
};

export default function RewardsAdminPanel() {
  const rewards = useRemote<Reward[]>("/admin/rewards");
  const redemptions = useRemote<Redemption[]>("/admin/redemptions");
  const [draft, setDraft] = useState<Reward | null>(null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || pending) return;
    setPending(true);
    setFailure("");
    try {
      await api(`/admin/rewards${draft.id ? `/${draft.id}` : ""}`, {
        method: draft.id ? "PATCH" : "POST",
        body: JSON.stringify({
          nombre: draft.nombre.trim(),
          descripcion: draft.descripcion.trim(),
          costoMonedas: draft.costoMonedas,
          stock: draft.stock,
          activo: draft.activo,
        }),
      });
      setDraft(null);
      setSuccess("La recompensa de demostración se guardó.");
      rewards.reload();
    } catch (reason: unknown) {
      setFailure(message(reason));
    } finally {
      setPending(false);
    }
  }
  async function decide(id: number, state: "APROBADO_DEMO" | "CANCELADO") {
    if (pending) return;
    setPending(true);
    setFailure("");
    try {
      await api(`/admin/redemptions/${id}`, {
        method: "POST",
        body: JSON.stringify({ estado: state }),
      });
      setSuccess(
        state === "CANCELADO"
          ? "Solicitud cancelada; se restituyeron las monedas y el stock correspondientes."
          : "Canje aprobado como demostración, sin entrega real.",
      );
      redemptions.reload();
      rewards.reload();
    } catch (reason: unknown) {
      setFailure(message(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap justify-between gap-3 mb-5">
        <p className="muted max-w-xl">
          Gestiona el catálogo y las solicitudes del piloto. Todos los productos
          y cupones se manejan como demostración.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => {
            setDraft({ ...newReward });
            setFailure("");
            setSuccess("");
          }}
        >
          Crear recompensa
        </button>
      </div>
      <Feedback error={failure} success={success} />
      <RemoteStatus
        loading={rewards.loading}
        error={rewards.error}
        retry={rewards.reload}
      />
      {rewards.data && !rewards.loading && !rewards.error && (
        <section className="card">
          <h2 className="font-bold text-xl mb-4">Catálogo</h2>
          {rewards.data.length === 0 ? (
            <p className="muted">Aún no hay recompensas registradas.</p>
          ) : (
            <div className="divide-y">
              {rewards.data.map((reward) => (
                <article
                  className="py-4 flex flex-wrap justify-between gap-3"
                  key={reward.id}
                >
                  <div>
                    <h3 className="font-semibold">{reward.nombre}</h3>
                    <p className="muted mt-1">{reward.descripcion}</p>
                    <p className="mt-2">
                      {number(reward.costoMonedas)} monedas · {reward.stock}{" "}
                      disponibles · {reward.activo ? "Activo" : "Desactivado"}
                    </p>
                  </div>
                  <button
                    className="btn btn-secondary self-start"
                    onClick={() => setDraft({ ...reward })}
                  >
                    Editar
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {draft && (
        <form className="card mt-5 brand-border" onSubmit={save}>
          <h2 className="font-bold text-xl mb-4">
            {draft.id ? "Editar recompensa" : "Nueva recompensa"}
          </h2>
          <label className="field">
            Nombre
            <input
              required
              minLength={3}
              maxLength={120}
              value={draft.nombre}
              onChange={(event) =>
                setDraft({ ...draft, nombre: event.target.value })
              }
            />
          </label>
          <label className="field mt-4">
            Descripción
            <textarea
              required
              rows={3}
              minLength={5}
              maxLength={500}
              value={draft.descripcion}
              onChange={(event) =>
                setDraft({ ...draft, descripcion: event.target.value })
              }
            />
          </label>
          <div className="grid-2 mt-4">
            <label className="field">
              Costo en monedas
              <input
                required
                type="number"
                min={0.01}
                max={1000000}
                step={0.01}
                value={draft.costoMonedas}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    costoMonedas: Number(event.target.value),
                  })
                }
              />
            </label>
            <label className="field">
              Stock disponible
              <input
                required
                type="number"
                min={0}
                max={1000000}
                step={1}
                value={draft.stock}
                onChange={(event) =>
                  setDraft({ ...draft, stock: Number(event.target.value) })
                }
              />
            </label>
          </div>
          <label className="flex items-center gap-2 mt-4">
            <input
              type="checkbox"
              checked={draft.activo}
              onChange={(event) =>
                setDraft({ ...draft, activo: event.target.checked })
              }
            />
            Visible en el catálogo
          </label>
          <div className="flex gap-3 mt-5">
            <button className="btn btn-primary" disabled={pending}>
              {pending ? "Guardando…" : "Guardar recompensa"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => setDraft(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      <section className="card mt-6">
        <h2 className="font-bold text-xl mb-4">Solicitudes de canje</h2>
        <RemoteStatus
          loading={redemptions.loading}
          error={redemptions.error}
          retry={redemptions.reload}
        />
        {redemptions.data &&
          !redemptions.loading &&
          !redemptions.error &&
          (redemptions.data.length === 0 ? (
            <p className="muted">Todavía no hay solicitudes.</p>
          ) : (
            <div className="divide-y">
              {redemptions.data.map((redemption) => (
                <article key={redemption.id} className="py-4">
                  <div className="flex flex-wrap justify-between gap-4">
                    <div>
                      <h3 className="font-semibold">
                        {redemption.recompensa.nombre} · @
                        {redemption.usuario.nickname ??
                          redemption.usuario.nombreUsuario}
                      </h3>
                      <p className="muted mt-1">
                        {dateTime(redemption.creadoEn)} ·{" "}
                        {number(redemption.costoMonedas)} monedas
                      </p>
                      <span className="badge mt-2">
                        {stateLabel(redemption.estado)}
                      </span>
                    </div>
                    {redemption.estado === "SOLICITADO_DEMO" && (
                      <div className="flex flex-wrap self-start gap-2">
                        <button
                          className="btn btn-primary"
                          disabled={pending}
                          onClick={() => decide(redemption.id, "APROBADO_DEMO")}
                        >
                          Aprobar demostración
                        </button>
                        <button
                          className="btn btn-secondary"
                          disabled={pending}
                          onClick={() => decide(redemption.id, "CANCELADO")}
                        >
                          Cancelar y devolver monedas
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ))}
      </section>
    </>
  );
}

