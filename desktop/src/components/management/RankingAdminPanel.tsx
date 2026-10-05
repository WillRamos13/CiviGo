
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Feedback, message } from "./common";

function previousMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "America/Lima",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return `${month === 1 ? year - 1 : year}-${String(month === 1 ? 12 : month - 1).padStart(2, "0")}`;
}

export default function RankingAdminPanel() {
  const [month, setMonth] = useState(previousMonth);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function settle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setSuccess("");
    try {
      await api("/admin/ranking/settle", {
        method: "POST",
        body: JSON.stringify({ mes: month }),
      });
      setSuccess(
        `Se cerró el ranking de ${month} y se registraron las monedas correspondientes. El cierre del mismo mes no vuelve a entregar premios.`,
      );
    } catch (reason: unknown) {
      setError(message(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="card max-w-3xl">
      <h2 className="text-xl font-bold mb-3">Cerrar ranking mensual</h2>
      <p className="muted">
        Después de terminar el mes, registra los premios para los primeros diez
        puestos. Se utilizan los puntos de participación de ese mes y los
        premios configurados.
      </p>
      <p className="notice mt-4">
        En caso de empate se suman los premios de las posiciones compartidas y
        se reparten entre los usuarios empatados, incluso cuando el empate cruza
        el décimo puesto.
      </p>
      <form onSubmit={settle} className="mt-5">
        <Feedback error={error} success={success} />
        <label className="field max-w-xs">
          Mes finalizado
          <input
            required
            type="month"
            value={month}
            max={previousMonth()}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-3 mt-5">
          <button className="btn btn-primary" disabled={pending}>
            {pending ? "Registrando premios…" : "Cerrar mes y asignar monedas"}
          </button>
          <Link className="btn btn-secondary" href="/ranking">
            Consultar ranking
          </Link>
        </div>
      </form>
      <p className="muted text-sm mt-4">
        Las monedas del piloto pertenecen a una demostración. Esta acción no
        registra pagos ni entregas reales.
      </p>
    </section>
  );
}

