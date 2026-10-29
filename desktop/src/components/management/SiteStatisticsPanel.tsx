import { useState } from "react";
import { useRemote, RemoteStatus, dateTime } from "./common";
import { MetricBars, MetricTiles, type MetricRow } from "./MetricCharts";
type Comparison = {
  label: string;
  current: number;
  previous: number;
  deltaPercent: number | null;
};
type Data = {
  generatedAt: string;
  totals: Record<string, number>;
  charts: Record<string, MetricRow[]>;
  districtComparison: Comparison[];
  typeComparison: Comparison[];
  notes: string[];
};
const sections = {
  comunidad: {
    label: "Comunidad y participación",
    charts: {
      registrations: "Nuevas cuentas · últimos seis meses",
      reportStates: "Reportes por estado",
      votes: "Confirmaciones y votos",
      flags: "Avisos de moderación",
      appeals: "Apelaciones",
    },
  },
  incidentes: {
    label: "Histórico y patrones",
    charts: {
      years: "Incidentes por año del hecho",
      sources: "Fuentes de los incidentes",
      evaluations: "Evaluación de los incidentes",
      hours: "Hora del hecho · Perú",
      weekdays: "Día del hecho · Perú",
    },
  },
  rutas: {
    label: "Recorridos",
    charts: {
      favorites: "Favoritos por transporte",
      routeHistory: "Recorridos guardados por transporte",
    },
  },
  recompensas: {
    label: "Recompensas y pagos",
    charts: {
      redemptions: "Canjes por estado",
      points: "Puntos otorgados por actividad",
      payments: "Pagos por entorno y estado",
    },
  },
  contenido: {
    label: "Publicidad, archivos y proveedores",
    charts: {
      announcements: "Anuncios por espacio y estado",
      attachmentTypes: "Adjuntos por formato y acceso",
      providers: "Consumo de API · mes UTC actual",
    },
  },
} as const;
function ComparisonTable({
  title,
  rows,
}: {
  title: string;
  rows: Comparison[];
}) {
  return (
    <article className="card">
      <h3>{title}</h3>
      <p className="muted text-sm">
        Mes actual frente a los mismos días del mes anterior. Fecha del hecho.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Grupo</th>
              <th>Actual</th>
              <th>Anterior comparable</th>
              <th>Variación</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th>{row.label}</th>
                <td>{row.current}</td>
                <td>{row.previous}</td>
                <td>
                  {row.deltaPercent === null
                    ? "Sin base"
                    : `${row.deltaPercent > 0 ? "+" : ""}${row.deltaPercent.toFixed(1)} %`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p>Sin registros en el período.</p>}
    </article>
  );
}
export default function SiteStatisticsPanel() {
  const remote = useRemote<Data>("/admin/site-statistics"),
    [section, setSection] = useState<keyof typeof sections>("comunidad");
  const d = remote.data,
    t = d?.totals;
  return (
    <section className="site-statistics">
      <div className="card-header">
        <h2>Actividad general de CiviGo</h2>
        <button
          className="btn btn-secondary"
          onClick={remote.reload}
          disabled={remote.loading}
        >
          Actualizar actividad
        </button>
      </div>
      <p className="muted">
        Alcance global: todos los registros. Los agregados se renuevan cada
        minuto. Los filtros de distrito y tipo del panel superior sólo afectan
        sus gráficos y exportaciones filtradas.
      </p>
      <RemoteStatus
        loading={remote.loading}
        error={remote.error}
        retry={remote.reload}
      />
      {remote.refreshError && (
        <p className="notice notice-warning">{remote.refreshError}</p>
      )}
      {d && t && (
        <>
          <MetricTiles
            values={[
              { label: "Incidentes registrados", value: t.incidents },
              { label: "Antecedentes históricos", value: t.historical },
              { label: "Gravedad pendiente", value: t.unevaluated },
              { label: "Cuentas bloqueadas", value: t.blocked },
              { label: "Premium activo · cuentas únicas", value: t.premium },
              {
                label: "Premium manual / de pago",
                value: `${t.premiumManual} / ${t.premiumPaid}`,
              },
              { label: "Mensajes de incidentes", value: t.messages },
              { label: "Monedas en cuentas", value: t.coinBalance },
              {
                label: "Archivos almacenados",
                value: t.attachments,
                detail: `${(t.attachmentBytes / 1048576).toFixed(1)} MB declarados`,
              },
              {
                label: "Recompensas del catálogo",
                value: t.rewardCatalog,
                detail: `${t.rewardStock} unidades de stock`,
              },
              { label: "Negocios activos", value: t.activeBusinesses },
              { label: "Impresiones de negocio", value: t.adImpressions },
              {
                label: "Ingresos aprobados · producción",
                value: `S/ ${(t.productionRevenueCents / 100).toFixed(2)}`,
                detail: `${t.approvedProductionPayments} pagos`,
              },
            ]}
          />
          <div
            className="metric-section-tabs"
            role="group"
            aria-label="Estadísticas de actividad"
          >
            {Object.entries(sections).map(([key, value]) => (
              <button
                className={`btn ${section === key ? "btn-primary" : "btn-secondary"}`}
                key={key}
                onClick={() => setSection(key as keyof typeof sections)}
                aria-pressed={section === key}
              >
                {value.label}
              </button>
            ))}
          </div>
          <div className="statistics-grid">
            {Object.entries(sections[section].charts).map(([key, title]) => (
              <MetricBars key={key} title={title} rows={d.charts[key] || []} />
            ))}
          </div>
          {section === "incidentes" && (
            <div className="statistics-grid">
              <ComparisonTable
                title="Variación por distrito"
                rows={d.districtComparison}
              />
              <ComparisonTable
                title="Variación por tipo de incidente"
                rows={d.typeComparison}
              />
            </div>
          )}
          <details className="card">
            <summary>Alcance de los datos</summary>
            {d.notes.map((note) => (
              <p className="muted text-sm" key={note}>
                {note}
              </p>
            ))}
            <p>Actualizado: {dateTime(d.generatedAt)}</p>
          </details>
        </>
      )}
    </section>
  );
}
