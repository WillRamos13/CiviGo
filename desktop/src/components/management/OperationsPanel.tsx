import { useRemote, RemoteStatus, dateTime } from "./common";
import { MetricTiles, MetricBars } from "./MetricCharts";
type Data = {
  enabled: boolean;
  generatedAt: string;
  since: string | null;
  lastPersisted: string | null;
  persistenceError: boolean;
  online: { users: number; visitors: number; web: number; mobile: number };
  api: {
    count: number;
    errors: number;
    clientErrors: number;
    meanMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    errorPercent: number | null;
    views: number;
  };
  process: {
    uptimeSeconds: number;
    memoryMb: number;
    heapMb: number;
    databaseOk: boolean;
    databaseMs: number | null;
  };
  timeline: {
    at: string;
    count: number;
    errors: number;
    views: number;
    meanMs: number | null;
  }[];
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
const ms = (n: number | null) => (n === null ? "Sin muestras" : `${n} ms`);
export default function OperationsPanel() {
  const r = useRemote<Data>("/admin/control"),
    d = r.data;
  const hours = new Map<string, number>();
  for (const row of d?.timeline || []) {
    const hour = row.at.slice(0, 13);
    hours.set(hour, (hours.get(hour) || 0) + row.count);
  }
  return (
    <section>
      <div className="card-header">
        <h2>Control y rendimiento</h2>
        <button
          className="btn btn-secondary"
          disabled={r.loading}
          onClick={r.reload}
        >
          Actualizar control
        </button>
      </div>
      <p className="muted">
        Actualización automática cada 30 segundos mientras este panel está
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
              La recopilación de métricas está desactivada en este servidor.
            </p>
          )}
          {d.persistenceError && (
            <p className="notice notice-warning">
              No se pudo guardar la muestra más reciente. Las cifras pueden
              estar incompletas.
            </p>
          )}
          <MetricTiles
            values={[
              {
                label: "Usuarios en línea",
                value: d.online.users,
                detail: "Cuentas autenticadas · últimos 120 s",
              },
              {
                label: "Visitantes en línea",
                value: d.online.visitors,
                detail: "Sesiones estimadas · últimos 120 s",
              },
              {
                label: "Sesiones visibles web / app",
                value: `${d.online.web} / ${d.online.mobile}`,
              },
              { label: "Latencia media de API", value: ms(d.api.meanMs) },
              {
                label: "API · p50 / p95",
                value: `${ms(d.api.p50Ms)} / ${ms(d.api.p95Ms)}`,
              },
              {
                label: "Errores de servidor",
                value:
                  d.api.errorPercent === null
                    ? null
                    : `${d.api.errorPercent} %`,
                detail: `${d.api.errors} respuestas 5xx · ${d.api.clientErrors} respuestas 4xx`,
              },
              { label: "Solicitudes de API · 24 h", value: d.api.count },
              { label: "Vistas registradas · 24 h", value: d.api.views },
              {
                label: "Base de datos · consulta actual",
                value: d.process.databaseOk
                  ? ms(d.process.databaseMs)
                  : "No disponible",
              },
              {
                label: "Memoria de esta instancia",
                value: `${d.process.memoryMb} MB`,
                detail: `Heap: ${d.process.heapMb} MB`,
              },
              {
                label: "Proceso iniciado hace",
                value: `${Math.floor(d.process.uptimeSeconds / 3600)} h ${Math.floor(d.process.uptimeSeconds / 60) % 60} min`,
              },
            ]}
          />
          <div className="statistics-grid">
            <MetricBars
              title="Solicitudes por hora · últimas 24 h"
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
              title="Errores 5xx por servicio"
              rows={d.routes.map((row) => ({
                label: row.label,
                count: row.errors,
              }))}
            />
          </div>
          <article className="card">
            <h3>Rendimiento de la API por servicio</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Servicio</th>
                    <th>Solicitudes</th>
                    <th>Media</th>
                    <th>p95</th>
                    <th>Errores 5xx</th>
                  </tr>
                </thead>
                <tbody>
                  {d.routes.map((row) => (
                    <tr key={row.label}>
                      <th>{row.label}</th>
                      <td>{row.count}</td>
                      <td>{ms(row.meanMs)}</td>
                      <td>{ms(row.p95Ms)}</td>
                      <td>{row.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
          <article className="card">
            <h3>Carga de las páginas</h3>
            <p className="muted text-sm">
              TTFB: primera respuesta · LCP: contenido principal · CLS:
              movimientos del diseño. Promedios de muestras recibidas; «—»
              indica que el navegador no aportó ese dato.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Página</th>
                    <th>Muestras</th>
                    <th>TTFB</th>
                    <th>LCP</th>
                    <th>CLS</th>
                  </tr>
                </thead>
                <tbody>
                  {d.pages.map((row) => (
                    <tr key={row.path}>
                      <th>{row.path}</th>
                      <td>{row.samples}</td>
                      <td>{ms(row.ttfb)}</td>
                      <td>{ms(row.lcp)}</td>
                      <td>{row.cls === null ? "—" : row.cls.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!d.pages.length && (
              <p className="muted">
                Todavía no se han recibido muestras de páginas.
              </p>
            )}
          </article>
          <details className="card">
            <summary>Cómo se miden estas cifras</summary>
            {d.notes.map((note) => (
              <p className="muted text-sm" key={note}>
                {note}
              </p>
            ))}
          </details>
          <p className="muted text-sm">
            Desde: {d.since ? dateTime(d.since) : "sin datos"} · Última lectura:{" "}
            {dateTime(d.generatedAt)} · Guardado:{" "}
            {d.lastPersisted ? dateTime(d.lastPersisted) : "pendiente"}
          </p>
        </>
      )}
    </section>
  );
}
