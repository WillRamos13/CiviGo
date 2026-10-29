export type MetricRow = { label: string; count: number };
export function MetricBars({
  title,
  rows,
  description,
}: {
  title: string;
  rows: MetricRow[];
  description?: string;
}) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.count)));
  return (
    <article className="card statistics-chart">
      <h3>{title}</h3>
      {description && <p className="muted text-sm">{description}</p>}
      {!rows.length ? (
        <p className="muted">Sin registros.</p>
      ) : (
        <div className="metric-bars" role="list" aria-label={title}>
          {rows.map((row, index) => (
            <div
              className="metric-bar"
              role="listitem"
              key={`${row.label}:${index}`}
            >
              <div>
                <span>{row.label}</span>
                <strong>
                  {new Intl.NumberFormat("es-PE", {
                    maximumFractionDigits: 2,
                  }).format(row.count)}
                </strong>
              </div>
              <i
                style={{
                  width: `${Math.max(0, (Math.abs(row.count) / max) * 100)}%`,
                }}
              />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
export function MetricTiles({
  values,
}: {
  values: { label: string; value: number | string | null; detail?: string }[];
}) {
  return (
    <div className="statistics-summary">
      {values.map((item) => (
        <article className="card" key={item.label}>
          <p className="muted text-sm">{item.label}</p>
          <strong className="text-2xl">
            {item.value === null
              ? "Sin muestras"
              : typeof item.value === "number"
                ? new Intl.NumberFormat("es-PE", {
                    maximumFractionDigits: 2,
                  }).format(item.value)
                : item.value}
          </strong>
          {item.detail && <small className="muted block">{item.detail}</small>}
        </article>
      ))}
    </div>
  );
}
