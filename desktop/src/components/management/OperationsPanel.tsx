import { useRemote, RemoteStatus, dateTime } from "./common";
import { MetricTiles, MetricBars } from "./MetricCharts";
type Data = {
  enabled: boolean;
  generatedAt: string;
  since: string | null;
  persistenceError: boolean;
  online: { users: number; visitors: number };
  api: {
    count: number;
    errors: number;
    clientErrors: number;
    p95Ms: number | null;
    errorPercent: number | null;
    views: number;
  };
  process: { databaseOk: boolean; databaseMs: number | null };
  timeline: { at: string; count: number }[];
  routes: {
    label: string;
    count: number;
    errors: number;
    meanMs: number;
    p95Ms: number | null;
  }[];
  pages: {
    path: string;
    samples: number;
    ttfb: number | null;
    lcp: number | null;
    cls: number | null;
  }[];
  notes: string[];
};
const ms = (value: number | null) =>
  value === null ? "Sin muestras" : `${value} ms`;
const names: Record<string, string> = {
  navigation: "Rutas y lugares",
  users: "Cuentas",
  incidents: "Incidentes",
  reports: "Reportes",
  uploads: "Archivos",
  payments: "Pagos",
  admin: "Administración",
  announcements: "Anuncios",
  chatbot: "Asistente",
  otros: "Otros servicios",
};
export default function OperationsPanel() {
  const r = useRemote<Data>("/admin/control"),
    d = r.data;
  const hours = new Map<string, number>();
  for (const row of d?.timeline || []) {
    const hour = row.at.slice(0, 13);
    hours.set(hour, (hours.get(hour) || 0) + row.count);
  }
  return (
    <section className="operations-panel">
      <div className="card-header">
        <div>
          <span className="admin-section-kicker">ESTADO DEL SERVICIO</span>
          <h2>Control y rendimiento</h2>
        </div>
        <button
          className="btn btn-secondary"
          disabled={r.loading}
          onClick={r.reload}
        >
          Actualizar control
        </button>
      </div>
      <p className="muted text-sm">
        Las cifras se actualizan cada 30 segundos mientras este panel está
        visible.
      </p>
      <RemoteStatus loading={r.loading} error={r.error} retry={r.reload} />
      {r.refreshError && (
        <p className="notice notice-warning">{r.refreshError}</p>
      )}
      {d && (
        <>
          {!d.enabled && (
            <p className="notice notice-warning">
              La recopilación está desactivada en el servidor.
            </p>
          )}
          {d.persistenceError && (
            <p className="notice notice-warning">
              Las últimas métricas no pudieron guardarse; las cifras pueden
              estar incompletas.
            </p>
          )}
          <MetricTiles
            values={[
              {
                label: "Usuarios en línea",
                value: d.online.users,
                detail: "Cuentas activas en los últimos 2 minutos",
              },
              {
                label: "Visitantes en línea",
                value: d.online.visitors,
                detail: "Sesiones visibles sin iniciar sesión",
              },
              {
                label: "Tiempo de respuesta · p95",
                value: ms(d.api.p95Ms),
                detail: "El 95 % de las solicitudes no supera este intervalo",
              },
              {
                label: "Errores del servicio",
                value:
                  d.api.errorPercent === null
                    ? null
                    : `${d.api.errorPercent} %`,
                detail: `${d.api.errors} respuestas 5xx · últimas 24 h`,
              },
              {
                label: "Vistas de páginas · 24 h",
                value: d.api.views,
                detail: "Muestras recibidas desde web y app",
              },
              {
                label: "Base de datos",
                value: d.process.databaseOk ? "Disponible" : "Sin respuesta",
                detail: d.process.databaseOk
                  ? `Consulta actual: ${ms(d.process.databaseMs)}`
                  : "Revisar conexión del servicio",
              },
            ]}
          />
          <div className="statistics-grid">
            <MetricBars
              title="Actividad por hora · últimas 24 h"
              rows={[...hours].map(([hour, count]) => ({
                label: new Date(hour + ":00:00Z").toLocaleString("es-PE", {
                  timeZone: "America/Lima",
                  day: "2-digit",
                  hour: "2-digit",
                }),
                count,
              }))}
            />
            <MetricBars
              title="Errores por servicio · últimas 24 h"
              rows={d.routes
                .filter((row) => row.errors > 0)
                .map((row) => ({
                  label: names[row.label] || row.label,
                  count: row.errors,
                }))}
            />
          </div>
          <article className="card">
            <h3>Carga de las páginas</h3>
            <p className="muted text-sm">
              LCP mide cuánto tarda en aparecer el contenido principal. Sin
              muestra significa que aún no llegó una medición de ese navegador.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Página</th>
                    <th>Muestras</th>
                    <th>Contenido principal · LCP</th>
                    <th>Primera respuesta</th>
                  </tr>
                </thead>
                <tbody>
                  {d.pages.map((row) => (
                    <tr key={row.path}>
                      <th>{row.path}</th>
                      <td>{row.samples}</td>
                      <td>{ms(row.lcp)}</td>
                      <td>{ms(row.ttfb)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!d.pages.length && (
              <p className="muted">
                Todavía no se recibieron muestras de carga.
              </p>
            )}
          </article>
          <details className="card">
            <summary>Detalle por servicio y alcance de las mediciones</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Servicio</th>
                    <th>Solicitudes</th>
                    <th>Media</th>
                    <th>p95</th>
                    <th>Errores</th>
                  </tr>
                </thead>
                <tbody>
                  {d.routes.map((row) => (
                    <tr key={row.label}>
                      <th>{names[row.label] || row.label}</th>
                      <td>{row.count}</td>
                      <td>{ms(row.meanMs)}</td>
                      <td>{ms(row.p95Ms)}</td>
                      <td>{row.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.notes.map((note) => (
              <p className="muted text-sm" key={note}>
                {note}
              </p>
            ))}
          </details>
          <p className="muted text-sm">
            Última lectura: {dateTime(d.generatedAt)} · Datos desde:{" "}
            {d.since ? dateTime(d.since) : "sin muestras"}
          </p>
        </>
      )}
    </section>
  );
}
