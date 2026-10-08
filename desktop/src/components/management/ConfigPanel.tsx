
import { useState } from "react";
import { api } from "@/lib/api";
import { Feedback, message, RemoteStatus, useRemote } from "./common";

interface Config {
  agrupacionMetros: number;
  agrupacionHoras: number;
  confirmacionMetros: number;
  confirmaciones: number;
  resoluciones: number;
  influenciaVecina: number;
  puntosReporte: number;
  puntosConfirmacion: number;
  puntosPrueba: number;
  premiosRanking: number[];
  anuncioMetros: number;
  intervaloAnuncioMetros: number;
  duracionAnuncioSegundos: number;
  maxVideoBytes: number;
}
const fields: {
  key: Exclude<
    keyof Config,
    "premiosRanking" | "maxVideoBytes" | "influenciaVecina"
  >;
  label: string;
  min: number;
  max: number;
  step?: number;
}[] = [
  {
    key: "agrupacionMetros",
    label: "Radio de agrupación (metros)",
    min: 10,
    max: 200,
  },
  {
    key: "agrupacionHoras",
    label: "Ventana de agrupación (horas)",
    min: 1,
    max: 24,
  },
  {
    key: "confirmacionMetros",
    label: "Radio de confirmación (metros)",
    min: 10,
    max: 200,
  },
  {
    key: "confirmaciones",
    label: "Confirmaciones para validar",
    min: 1,
    max: 20,
  },
  { key: "resoluciones", label: "Votos para resolver", min: 1, max: 20 },
  {
    key: "puntosReporte",
    label: "Puntos por reporte validado",
    min: 0.01,
    max: 1000,
    step: 0.01,
  },
  {
    key: "puntosConfirmacion",
    label: "Puntos por confirmación válida",
    min: 0.01,
    max: 1000,
    step: 0.01,
  },
  {
    key: "puntosPrueba",
    label: "Puntos por prueba aceptada",
    min: 0.01,
    max: 1000,
    step: 0.01,
  },
  {
    key: "anuncioMetros",
    label: "Distancia al negocio para recomendar (metros)",
    min: 10,
    max: 200,
  },
  {
    key: "intervaloAnuncioMetros",
    label: "Separación entre anuncios (metros recorridos)",
    min: 50,
    max: 5000,
  },
  {
    key: "duracionAnuncioSegundos",
    label: "Duración de tarjeta publicitaria (segundos)",
    min: 3,
    max: 15,
  },
];

function ConfigForm({ initial, done }: { initial: Config; done: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await api("/admin/config", {
        method: "PATCH",
        body: JSON.stringify(draft),
      });
      done();
    } catch (reason: unknown) {
      setError(message(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h2 className="text-xl font-bold">Reglas configurables</h2>
      <p className="muted mt-2 mb-5">
        Estos parámetros controlan CiviGo. Los puntos de participación y
        premios inicialmente propuestos pueden ajustarse después de observar sus
        resultados.
      </p>
      <Feedback error={error} />
      <div className="grid-2">
        {fields.map((field) => (
          <label className="field" key={field.key}>
            {field.label}
            <input
              required
              type="number"
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              value={draft[field.key]}
              onChange={(event) =>
                setDraft({ ...draft, [field.key]: Number(event.target.value) })
              }
            />
          </label>
        ))}
        <label className="field">
          Influencia hacia tramos conectados (%)
          <input
            required
            type="number"
            min={1}
            max={50}
            step={1}
            value={Math.round(draft.influenciaVecina * 100)}
            onChange={(event) =>
              setDraft({
                ...draft,
                influenciaVecina: Number(event.target.value) / 100,
              })
            }
          />
        </label>
        <label className="field">
          Peso máximo de un video (MB)
          <input
            required
            type="number"
            min={1}
            max={30}
            step={1}
            value={draft.maxVideoBytes / (1024 * 1024)}
            onChange={(event) =>
              setDraft({
                ...draft,
                maxVideoBytes: Number(event.target.value) * 1024 * 1024,
              })
            }
          />
        </label>
      </div>
      <fieldset className="mt-6">
        <legend className="font-bold text-lg">
          Monedas por puesto del ranking
        </legend>
        <p className="muted mt-2 mb-4">
          Las monedas se entregan al cerrar un mes. Los empates comparten el
          promedio de los premios de los puestos involucrados.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 10 }, (_, index) => (
            <label className="field" key={index}>
              Puesto {index + 1}
              <input
                required
                type="number"
                min={0}
                max={100000}
                step={0.01}
                value={draft.premiosRanking[index] ?? 0}
                onChange={(event) => {
                  const prizes = Array.from(
                    { length: 10 },
                    (_, i) => draft.premiosRanking[i] ?? 0,
                  );
                  prizes[index] = Number(event.target.value);
                  setDraft({ ...draft, premiosRanking: prizes });
                }}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <p className="notice mt-5">
        Los cambios se registran para su revisión. No alteran retroactivamente
        los canjes ya solicitados ni sustituyen una decisión de un agente.
      </p>
      <button className="btn btn-primary mt-5" disabled={pending}>
        {pending ? "Guardando…" : "Guardar configuración"}
      </button>
    </form>
  );
}

export default function ConfigPanel() {
  const { data, loading, error, reload } = useRemote<Config>("/admin/config");
  const [success, setSuccess] = useState("");
  return (
    <>
      <Feedback success={success} />
      <RemoteStatus loading={loading} error={error} retry={reload} />
      {data && !loading && !error && (
        <ConfigForm
          key={JSON.stringify(data)}
          initial={data}
          done={() => {
            setSuccess("La configuración de CiviGo se guardó.");
            reload();
          }}
        />
      )}
    </>
  );
}

