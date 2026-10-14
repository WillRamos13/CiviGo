import { useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { unwrap, errorMessage } from "@/lib/api";

export type ExportTable =
  "usuarios" | "reportes" | "incidentes" | "catalogo" | "estadisticas";
export interface ExportFilters {
  district?: string;
  type?: string;
}

export function ExportButton({
  table,
  filters,
  label,
}: {
  table: ExportTable;
  filters?: ExportFilters;
  label: string;
}) {
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState(""),
    [error, setError] = useState("");
  return (
    <div className="excel-export-action">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setError("");
          setResult("");
          try {
            const saved = unwrap(
              await window.civigoDesktop.exportExcel({
                table,
                ...(filters ? { filters } : {}),
              }),
            );
            setResult(
              saved.cancelado
                ? "Exportación cancelada."
                : `${saved.filas ?? 0} filas guardadas en Excel.`,
            );
          } catch (reason) {
            setError(errorMessage(reason));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={16} />
        {busy ? "Preparando Excel…" : label}
      </button>
      {result && (
        <span className="text-sm muted" role="status">
          {result}
        </span>
      )}
      {error && (
        <span className="text-sm notice-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function ExcelExportToolbar() {
  return (
    <section className="excel-export-toolbar" aria-label="Exportación de datos">
      <div>
        <FileSpreadsheet size={19} />
        <strong>Exportar a Excel</strong>
        <span>Todos los registros, aunque la lista tenga varias páginas.</span>
      </div>
      <div className="excel-export-buttons">
        <ExportButton table="usuarios" label="Usuarios" />
        <ExportButton table="reportes" label="Reportes" />
        <ExportButton table="incidentes" label="Incidentes" />
        <ExportButton table="catalogo" label="Catálogo" />
        <ExportButton table="estadisticas" label="Estadísticas" />
      </div>
    </section>
  );
}
