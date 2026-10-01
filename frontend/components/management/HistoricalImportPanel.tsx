"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { dateTime, Feedback, message } from "./common";

interface ImportInput {
  formato: "csv" | "json";
  contenido: string;
  fuente: string;
}
interface HistoricalRecord {
  fila: number;
  tipo: string;
  tipoNombre?: string;
  descripcion: string;
  fechaEvento: string;
  latitud: number;
  longitud: number;
  nivelRiesgo: number;
  referencia?: string;
}
interface ImportPreview {
  registros: HistoricalRecord[];
  errores: { fila: number; mensaje: string }[];
  total: number;
  totalValidos: number;
}
interface ImportResult {
  importados: number;
  duplicados?: number;
  errores?: { fila: number; mensaje: string }[];
}

export default function HistoricalImportPanel() {
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState("");
  const [fileData, setFileData] = useState<Omit<ImportInput, "fuente"> | null>(
    null,
  );
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewedInput, setPreviewedInput] = useState<ImportInput | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const reading = useRef(0);

  async function readFile(event: React.ChangeEvent<HTMLInputElement>) {
    const sequence = ++reading.current;
    setError("");
    setSuccess("");
    setPreview(null);
    setPreviewedInput(null);
    setFileData(null);
    const file = event.target.files?.[0];
    setFilename(file?.name ?? "");
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError(
        "El archivo debe pesar como máximo 2 MB. Divide los datos en archivos más pequeños.",
      );
      return;
    }
    const extension = file.name.toLowerCase().split(".").pop();
    if (extension !== "csv" && extension !== "json") {
      setError("Selecciona un archivo CSV o JSON.");
      return;
    }
    try {
      const contenido = await file.text();
      if (sequence === reading.current)
        setFileData({ formato: extension, contenido });
    } catch (reason: unknown) {
      setError(message(reason));
    }
  }

  async function prepare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fileData || pending) return;
    setPending(true);
    setError("");
    setSuccess("");
    setPreview(null);
    setPreviewedInput(null);
    const input = { ...fileData, fuente: source.trim() };
    try {
      const result = await api<ImportPreview>("/history/import/preview", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setPreview(result);
      setPreviewedInput(input);
    } catch (reason: unknown) {
      setError(message(reason));
    } finally {
      setPending(false);
    }
  }

  async function commit() {
    if (!previewedInput || !preview || preview.totalValidos === 0 || pending)
      return;
    setPending(true);
    setError("");
    setSuccess("");
    try {
      const result = await api<ImportResult>("/history/import/commit", {
        method: "POST",
        body: JSON.stringify(previewedInput),
      });
      setSuccess(
        `Se importaron ${result.importados} antecedentes históricos${result.duplicados ? `; ${result.duplicados} registros ya existentes no se duplicaron` : ""}. Los registros mantienen su procedencia y la fecha del hecho.`,
      );
      if (result.errores?.length)
        setError(
          `Algunos registros no se importaron: ${result.errores.map((item) => `fila ${item.fila}: ${item.mensaje}`).join("; ")}`,
        );
      setPreview(null);
      setPreviewedInput(null);
    } catch (reason: unknown) {
      setError(message(reason));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2 className="text-xl font-bold">Importar antecedentes históricos</h2>
        <p className="muted mt-2">
          Carga información de una fuente identificada. Los antecedentes se
          distinguen de reportes ciudadanos y se valoran según la fecha del
          hecho.
        </p>
        <p className="notice mt-4">
          Para asignar un antecedente a un tramo hacen falta coordenadas
          suficientemente precisas. Una estadística por distrito no debe
          convertirse en un incidente con ubicación inventada.
        </p>
        <form onSubmit={prepare}>
          <label className="field">
            Nombre o referencia de la fuente
            <input
              required
              minLength={3}
              maxLength={150}
              value={source}
              disabled={pending}
              onChange={(event) => {
                setSource(event.target.value);
                setPreview(null);
                setPreviewedInput(null);
              }}
              placeholder="Nombre del conjunto de datos y su procedencia"
            />
          </label>
          <label className="field">
            Archivo CSV o JSON
            <input
              type="file"
              required
              accept=".csv,.json,text/csv,application/json"
              disabled={pending}
              onChange={readFile}
            />
            <small>
              Máximo 2 MB y 2000 registros. No incluyas nombres personales,
              documentos, teléfonos ni fotografías. No se incluye ningún
              conjunto de datos de ejemplo como información real.
            </small>
          </label>
          <details className="rounded-xl bg-slate-50 p-4 mb-4">
            <summary className="font-semibold cursor-pointer">
              Formato del archivo
            </summary>
            <p className="muted mt-3">
              CSV: primera fila con los nombres de columnas. JSON: lista de
              objetos. Utiliza los siguientes campos:
            </p>
            <ul className="space-y-1">
              <li>
                <strong>tipo:</strong> nombre o identificador textual del tipo
                del catálogo.
              </li>
              <li>
                <strong>fechaEvento:</strong> fecha del hecho en formato ISO,
                por ejemplo AAAA-MM-DD.
              </li>
              <li>
                <strong>latitud y longitud:</strong> ubicación geográfica real.
              </li>
              <li>
                <strong>nivelRiesgo:</strong> gravedad de 1 a 5.
              </li>
              <li>
                <strong>descripcion:</strong> descripción del antecedente, sin
                datos personales.
              </li>
              <li>
                <strong>referencia:</strong> identificador del registro en la
                fuente, si existe.
              </li>
            </ul>
          </details>
          <Feedback error={error} success={success} />
          <button className="btn btn-primary" disabled={!fileData || pending}>
            {pending ? "Procesando…" : "Revisar archivo antes de importar"}
          </button>
        </form>
      </section>
      {preview && (
        <section className="card">
          <h2 className="text-xl font-bold">Revisión de {filename}</h2>
          <p className="mt-2">
            {preview.totalValidos} registros válidos de {preview.total}. Fuente:{" "}
            {previewedInput?.fuente}.
          </p>
          {preview.errores.length > 0 && (
            <div className="notice notice-error mt-4">
              <p className="font-semibold">
                Registros que necesitan corrección
              </p>
              <ul>
                {preview.errores.slice(0, 30).map((item, index) => (
                  <li key={`${item.fila}-${index}`}>
                    Fila {item.fila}: {item.mensaje}
                  </li>
                ))}
              </ul>
              {preview.errores.length > 30 && (
                <p>
                  Hay {preview.errores.length - 30} errores adicionales. Corrige
                  el archivo antes de continuar.
                </p>
              )}
            </div>
          )}
          <div className="overflow-x-auto mt-4">
            <table className="min-w-[600px]">
              <caption className="sr-only">
                Vista previa de antecedentes válidos, hasta cincuenta registros
              </caption>
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Tipo</th>
                  <th>Fecha del hecho</th>
                  <th>Gravedad</th>
                  <th>Descripción</th>
                </tr>
              </thead>
              <tbody>
                {preview.registros.slice(0, 50).map((record, index) => (
                  <tr key={`${record.fila}-${index}`}>
                    <td>{record.fila}</td>
                    <td>{record.tipoNombre ?? record.tipo}</td>
                    <td>{dateTime(record.fechaEvento)}</td>
                    <td>{record.nivelRiesgo}</td>
                    <td>{record.descripcion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.registros.length > 50 && (
            <p className="muted text-sm mt-3">
              Se muestran los primeros cincuenta registros de la revisión.
            </p>
          )}
          <p className="notice mt-4">
            La importación conservará estos datos como antecedentes. No genera
            puntos de participación ni monedas para la cuenta administradora.
          </p>
          <button
            className="btn btn-primary"
            disabled={
              pending || preview.totalValidos < 1 || preview.errores.length > 0
            }
            onClick={commit}
          >
            {pending
              ? "Importando…"
              : `Importar ${preview.totalValidos} antecedentes`}
          </button>
          {preview.errores.length > 0 && (
            <p className="muted text-sm mt-3">
              Corrige todos los errores y vuelve a revisar el archivo para
              habilitar la importación.
            </p>
          )}
        </section>
      )}
    </>
  );
}
