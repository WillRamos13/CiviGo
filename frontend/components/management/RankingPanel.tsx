"use client";

import { useState } from "react";
import Link from "next/link";
import { number, RemoteStatus, useRemote } from "./common";

interface RankingEntry {
  usuarioId?: number;
  position: number;
  nickname: string;
  puntos: number;
  monedasEstimadas?: number;
  credibilidad?: number | null;
}
interface RankingData {
  mes: string;
  entries: RankingEntry[];
  finalized?: boolean;
}

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "America/Lima",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

export default function RankingPanel() {
  const [month, setMonth] = useState(currentMonth);
  const { data, error, loading, reload } = useRemote<RankingData>(
    `/ranking?mes=${encodeURIComponent(month)}`,
  );
  return (
    <div className="page max-w-5xl">
      <div className="page-heading">
        <div>
          <span className="badge">Comunidad de Ica</span>
          <h1 className="mt-3">Ranking mensual</h1>
          <p className="muted">
            Reconocemos los aportes que ayudan a mejorar la información de
            CiviGo.
          </p>
        </div>
        <label className="field">
          Mes
          <input
            type="month"
            value={month}
            max={currentMonth()}
            onChange={(event) => {
              if (event.target.value) setMonth(event.target.value);
            }}
          />
        </label>
      </div>
      <p className="notice mb-5">
        El ranking utiliza los puntos obtenidos en el mes. La credibilidad
        personal y las monedas acumuladas se contabilizan por separado.
      </p>
      <RemoteStatus loading={loading} error={error} retry={reload} />
      {!loading && !error && data && (
        <section className="card overflow-x-auto">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-xl font-bold">Participación del mes</h2>
            <span className="badge">
              {data.finalized ? "Mes cerrado" : "En curso"}
            </span>
          </div>
          {data.entries.length === 0 ? (
            <div className="py-10 text-center">
              <p className="font-medium">
                Todavía no hay puntos registrados en este mes.
              </p>
              <p className="muted mt-2">
                Los aportes validados y las contribuciones admitidas se
                reflejarán aquí.
              </p>
            </div>
          ) : (
            <table className="w-full min-w-[460px] text-left">
              <caption className="sr-only">
                Usuarios ordenados por puntos de participación mensual
              </caption>
              <thead>
                <tr className="border-b">
                  <th className="p-3">Puesto</th>
                  <th className="p-3">Nickname</th>
                  <th className="p-3 text-right">Puntos</th>
                  <th className="p-3 text-right">
                    {data.finalized ? "Monedas asignadas" : "Monedas previstas"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry, index) => (
                  <tr
                    key={entry.usuarioId ?? `${entry.nickname}-${index}`}
                    className="border-b last:border-0"
                  >
                    <td className="p-3">
                      <span
                        className={
                          entry.position <= 3
                            ? "badge bg-amber-100 text-amber-900"
                            : "font-medium"
                        }
                      >
                        #{entry.position}
                      </span>
                    </td>
                    <th scope="row" className="p-3 font-semibold">
                      {entry.nickname}
                    </th>
                    <td className="p-3 text-right">{number(entry.puntos)}</td>
                    <td className="p-3 text-right">
                      {entry.monedasEstimadas === undefined
                        ? "Por definir"
                        : number(entry.monedasEstimadas)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      <section className="grid-2 mt-6">
        <div className="card">
          <h2 className="font-bold text-lg">Monedas del ranking</h2>
          <p className="muted mt-2">
            Los diez primeros puestos pueden recibir monedas según los premios
            configurados. Se acumulan en tu cuenta y puedes usarlas en el
            catálogo de demostración.
          </p>
          <Link className="btn btn-secondary mt-4" href="/recompensas">
            Ver recompensas
          </Link>
        </div>
        <div className="card">
          <h2 className="font-bold text-lg">Empates y credibilidad</h2>
          <p className="muted mt-2">
            Al empatar, se suman los premios de las posiciones compartidas y se
            dividen entre sus participantes. La credibilidad se establece desde
            el tercer reporte validado y no mejora al adquirir Premium.
          </p>
        </div>
      </section>
    </div>
  );
}
