import { useMemo, useState } from "react";
import { BarChart3, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { formatDate } from "@/lib/api";
import { useRemote } from "./common";
import { ExportButton } from "./ExcelExport";
import SiteStatisticsPanel from "./SiteStatisticsPanel";

interface CountRow {
  key: string;
  label: string;
  count: number;
}
interface MonthRow {
  month: string;
  label: string;
  incidents: number;
  reports: number;
  crimes: number;
}
interface AccountRow {
  role: string;
  count: number;
  verified: number;
  unverified: number;
}
interface StatisticsData {
  generatedAt: string;
  timeZone: string;
  filters: { district?: string | null; type?: string | null };
  totals: {
    incidents: number;
    reports: number;
    accounts: number;
    published: number;
    active: number;
    validated: number;
    resolved: number;
    verifiedAccounts: number;
    securityIncidents: number;
  };
  datasets: {
    types: CountRow[];
    districts: CountRow[];
    statuses: CountRow[];
    severities: CountRow[];
    timeline: MonthRow[];
    accounts: AccountRow[];
  };
  crimeComparison: {
    current: number;
    previousSameDays: number;
    previousFullMonth: number;
    deltaPercent: number | null;
  };
  incidentComparison: { current: number; previousSameDays: number; previousFullMonth: number; deltaPercent: number | null };
}
interface CatalogData {
  distritos: string[];
  categorias: { tipos: { nombre: string; slug: string }[] }[];
}

const colors = [
  "#1554d8",
  "#0b9ab4",
  "#7c5ed9",
  "#d99112",
  "#d55262",
  "#469447",
];
const roleLabels: Record<string, string> = {
  ADMIN: "Administradores",
  AGENTE: "Agentes",
  USUARIO: "Ciudadanos",
};
const count = (value: number) => new Intl.NumberFormat("es-PE").format(value);

function DataTable({ rows }: { rows: CountRow[] }) {
  return (
    <details className="statistics-data">
      <summary>Ver cifras</summary>
      <table>
        <thead>
          <tr>
            <th>Grupo</th>
            <th>Registros</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{count(row.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Bars({
  rows,
  label,
  color = colors[0],
}: {
  rows: CountRow[];
  label: string;
  color?: string;
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  if (!rows.length || rows.every((row) => row.count === 0))
    return (
      <p className="statistics-empty">No hay registros para estos filtros.</p>
    );
  const height = rows.length * 31 + 12;
  return (
    <>
      <div className="statistics-bars">
        <svg role="img" aria-label={label} viewBox={`0 0 600 ${height}`}>
          <title>{label}</title>
          {rows.map((row, index) => (
            <g key={row.key} transform={`translate(0,${index * 31 + 5})`}>
              <text x="0" y="17" className="stat-label">
                {row.label.length > 27
                  ? row.label.slice(0, 26) + "…"
                  : row.label}
              </text>
              <rect
                x="220"
                y="1"
                width={Math.max(
                  row.count > 0 ? 2 : 0,
                  (row.count / maximum) * 320,
                )}
                height="21"
                rx="5"
                fill={color}
              />
              <text
                x={230 + (row.count / maximum) * 320}
                y="17"
                className="stat-value"
              >
                {count(row.count)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <DataTable rows={rows} />
    </>
  );
}

function Donut({ rows, label }: { rows: CountRow[]; label: string }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  let offset = 0;
  const circumference = 2 * Math.PI * 74;
  if (!total)
    return (
      <p className="statistics-empty">No hay registros para estos filtros.</p>
    );
  return (
    <>
      <div className="statistics-donut">
        <svg role="img" aria-label={label} viewBox="0 0 220 220">
          <title>{label}</title>
          {rows.map((row, index) => {
            const length = (row.count / total) * circumference,
              start = offset;
            offset += length;
            return (
              <circle
                key={row.key}
                cx="110"
                cy="110"
                r="74"
                fill="none"
                stroke={colors[index % colors.length]}
                strokeWidth="26"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-start}
                transform="rotate(-90 110 110)"
              />
            );
          })}
          <text
            x="110"
            y="110"
            textAnchor="middle"
            className="stat-donut-total"
          >
            {count(total)}
          </text>
          <text x="110" y="134" textAnchor="middle" className="stat-label">
            registros
          </text>
        </svg>
        <ul>
          {rows.map((row, index) => (
            <li key={row.key}>
              <i style={{ background: colors[index % colors.length] }} />
              <span>{row.label}</span>
              <strong>{count(row.count)}</strong>
            </li>
          ))}
        </ul>
      </div>
      <DataTable rows={rows} />
    </>
  );
}

function Timeline({ rows }: { rows: MonthRow[] }) {
  const maximum = Math.max(
    1,
    ...rows.flatMap((row) => [row.incidents, row.reports, row.crimes]),
  );
  return (
    <>
      <div className="statistics-timeline">
        <svg
          role="img"
          aria-label="Evolución mensual de incidentes, reportes y seguridad"
          viewBox="0 0 600 220"
        >
          <title>Evolución de los últimos seis meses por fecha del hecho</title>
          {[0, 0.5, 1].map((step) => (
            <g key={step}>
              <line
                x1="35"
                y1={174 - 145 * step}
                x2="595"
                y2={174 - 145 * step}
                className="stat-grid"
              />
              <text x="0" y={178 - 145 * step} className="stat-label">
                {count(Math.round(maximum * step))}
              </text>
            </g>
          ))}
          {rows.map((row, index) => (
            <g key={row.month} transform={`translate(${53 + index * 91},0)`}>
              {(["incidents", "reports", "crimes"] as const).map(
                (key, position) => (
                  <rect
                    key={key}
                    x={position * 19}
                    y={174 - (row[key] / maximum) * 145}
                    width="15"
                    height={(row[key] / maximum) * 145}
                    rx="3"
                    fill={colors[position]}
                  />
                ),
              )}
              <text x="27" y="197" textAnchor="middle" className="stat-label">
                {row.label}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="statistics-series">
        {["Incidentes", "Reportes", "Seguridad"].map((label, index) => (
          <span key={label}>
            <i style={{ background: colors[index] }} />
            {label}
          </span>
        ))}
      </div>
      <details className="statistics-data">
        <summary>Ver cifras mensuales</summary>
        <table>
          <thead>
            <tr>
              <th>Mes</th>
              <th>Incidentes</th>
              <th>Reportes</th>
              <th>Seguridad</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month}>
                <th scope="row">{row.label}</th>
                <td>{count(row.incidents)}</td>
                <td>{count(row.reports)}</td>
                <td>{count(row.crimes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

function ChartCard({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="card statistics-chart">
      <h3>{title}</h3>
      {description && <p className="muted text-sm">{description}</p>}
      {children}
    </article>
  );
}

export default function StatisticsPanel() {
  const [district, setDistrict] = useState(""),
    [type, setType] = useState("");
  const [comparisonGroup, setComparisonGroup] = useState("all");
  const filters = useMemo(
    () => ({ ...(district ? { district } : {}), ...(type ? { type } : {}) }),
    [district, type],
  );
  const query = new URLSearchParams(filters).toString();
  const { data, loading, error, refreshError, reload } =
    useRemote<StatisticsData>("/admin/statistics" + (query ? "?" + query : ""));
  const catalog = useRemote<CatalogData>("/catalog");
  const types =
    catalog.data?.categorias.flatMap((category) => category.tipos) ?? [];
  const comparison = comparisonGroup === "security" ? data?.crimeComparison : data?.incidentComparison;
  return (
    <section className="statistics-panel" aria-label="Estadísticas de CiviGo">
      <header className="statistics-heading">
        <div>
          <span className="eyebrow">
            <BarChart3 size={16} /> PANORAMA DE LA COMUNIDAD
          </span>
          <h2>Estadísticas</h2>
          <p className="muted">
            Distribución de los últimos seis meses según la fecha del hecho.
            Las cuentas corresponden al registro general.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading}
          onClick={reload}
        >
          <RefreshCw size={16} />
          {loading ? "Actualizando…" : "Actualizar estadísticas"}
        </button>
      </header>
      <div className="statistics-filters">
        <label className="field">
          Distrito
          <select
            aria-label="Distrito de estadísticas"
            value={district}
            onChange={(event) => setDistrict(event.target.value)}
          >
            <option value="">Toda la provincia</option>
            {(catalog.data?.distritos ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Tipo de incidente
          <select
            aria-label="Tipo de estadísticas"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">Todos los tipos</option>
            {types.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.nombre}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!district && !type}
          onClick={() => {
            setDistrict("");
            setType("");
          }}
        >
          Ver panorama general
        </button>
      </div>
      {loading && (
        <p className="muted" role="status">
          Actualizando estadísticas…
        </p>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
          <button type="button" className="btn btn-secondary" onClick={reload}>
            Reintentar
          </button>
        </div>
      )}
      {refreshError && (
        <div className="notice notice-error" role="status">
          {refreshError} Se conservan las últimas cifras disponibles.
        </div>
      )}
      {data && (
        <>
          <div className="statistics-totals">
            {[
              ["Incidentes", data.totals.incidents],
              ["Reportes", data.totals.reports],
              ["Incidentes de seguridad", data.totals.securityIncidents],
              ["Usuarios", data.totals.accounts],
              ["Correos verificados", data.totals.verifiedAccounts],
            ].map(([label, value]) => (
              <div className="card" key={label}>
                <span>{label}</span>
                <strong>{count(Number(value))}</strong>
              </div>
            ))}
          </div>
          <article className="statistics-comparison card">
            <div>
              <span className="eyebrow">{comparisonGroup === "security" ? "INCIDENTES DE SEGURIDAD" : "TODOS LOS INCIDENTES FILTRADOS"}</span>
              <h3>Mes actual frente al anterior</h3>
              <label className="field statistics-comparison-select">Comparar registros de<select aria-label="Comparar registros de" value={comparisonGroup} onChange={event => setComparisonGroup(event.target.value)}><option value="all">Todos los incidentes</option><option value="security">Incidentes de seguridad</option></select></label>
              <p className="muted text-sm">
                Se compara el avance del mes con los mismos días del mes
                anterior, hasta la misma hora de Perú.
              </p>
            </div>
            <div className="statistics-comparison-values">
              <div>
                <span>Mes actual hasta hoy</span>
                <strong>{count(comparison?.current ?? 0)}</strong>
              </div>
              <div>
                <span>Mismo periodo anterior</span>
                <strong>{count(comparison?.previousSameDays ?? 0)}</strong>
              </div>
              <div className="statistics-delta">
                {comparison?.deltaPercent == null ? (
                  <>
                    <strong>Sin base</strong>
                    <span>No hubo registros en el periodo anterior.</span>
                  </>
                ) : (
                  <>
                    <strong>
                      {comparison.deltaPercent >= 0 ? (
                        <TrendingUp size={21} />
                      ) : (
                        <TrendingDown size={21} />
                      )}{" "}
                      {comparison.deltaPercent > 0 ? "+" : ""}
                      {new Intl.NumberFormat("es-PE", {
                        maximumFractionDigits: 1,
                      }).format(comparison.deltaPercent)}{" "}
                      %
                    </strong>
                    <span>
                      {comparison.deltaPercent > 0
                        ? "Aumento de registros"
                        : comparison.deltaPercent < 0
                          ? "Disminución de registros"
                          : "Sin variación"}
                    </span>
                  </>
                )}
              </div>
            </div>
            <p className="muted text-sm">
              Mes anterior completo:{" "}
              {count(comparison?.previousFullMonth ?? 0)} registros. Seguridad
              incluye delitos reportados y avisos de persona sospechosa. Las cifras
              corresponden a los registros de CiviGo.
            </p>
          </article>
          <div className="statistics-grid">
            <ChartCard title="Incidentes por tipo">
              <Bars
                rows={data.datasets.types}
                label="Número de incidentes por tipo"
              />
            </ChartCard>
            <ChartCard title="Incidentes por distrito">
              <Bars
                rows={data.datasets.districts}
                label="Número de incidentes por distrito"
                color={colors[1]}
              />
            </ChartCard>
            <ChartCard title="Estado de los incidentes">
              <Donut
                rows={data.datasets.statuses}
                label="Distribución por estado de los incidentes"
              />
            </ChartCard>
            <ChartCard title="Gravedad registrada">
              <Bars
                rows={data.datasets.severities}
                label="Número de incidentes por gravedad"
                color={colors[3]}
              />
            </ChartCard>
            <ChartCard
              title="Evolución mensual"
              description="Últimos seis meses. El mes actual muestra su avance hasta hoy."
            >
              <Timeline rows={data.datasets.timeline} />
            </ChartCard>
            <ChartCard
              title="Cuentas y verificación"
              description="Registro general de cuentas, independiente del tipo de incidente."
            >
              <Donut
                rows={data.datasets.accounts.map((row) => ({
                  key: row.role,
                  label: roleLabels[row.role] || row.role,
                  count: row.count,
                }))}
                label="Cuentas por rol"
              />
              <div className="statistics-account-verification">
                {data.datasets.accounts.map((row) => (
                  <p key={row.role}>
                    <strong>{roleLabels[row.role] || row.role}</strong>
                    <span>
                      {count(row.verified)} verificadas ·{" "}
                      {count(row.unverified)} sin verificar
                    </span>
                  </p>
                ))}
              </div>
            </ChartCard>
          </div>
          <footer className="statistics-footer">
            <p className="muted text-sm">
              Actualizado: {formatDate(data.generatedAt)} · Hora de Perú
            </p>
            <div className="excel-export-buttons">
              <ExportButton
                table="estadisticas"
                filters={filters}
                label="Exportar estadísticas"
              />
              <ExportButton
                table="incidentes"
                filters={filters}
                label="Exportar incidentes filtrados"
              />
              <ExportButton
                table="reportes"
                filters={filters}
                label="Exportar reportes filtrados"
              />
            </div>
          </footer>
        </>
      )}
      <SiteStatisticsPanel />
    </section>
  );
}
