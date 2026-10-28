import { useRemote, RemoteStatus, dateTime } from "./common";
type Payment = {
  referencia: string;
  usuarioId: number;
  centimos: number;
  moneda: string;
  estado: string;
  creadoEn: string;
  modo: string;
};
export default function PaymentsPanel() {
  const { data, error, loading, reload } =
    useRemote<Payment[]>("/payments/manage");
  return (
    <section className="card">
      <div className="card-header">
        <h2>Pagos de Premium</h2>
        <button className="btn btn-secondary" onClick={reload}>
          Actualizar
        </button>
      </div>
      <p className="muted">
        Los estados se consultan al proveedor. Esta pantalla no permite aprobar
        pagos manualmente.
      </p>
      <RemoteStatus loading={loading} error={error} retry={reload} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Compra</th>
              <th>Usuario</th>
              <th>Importe</th>
              <th>Estado</th>
              <th>Entorno</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((row) => (
              <tr key={row.referencia}>
                <td>{row.referencia}</td>
                <td>#{row.usuarioId}</td>
                <td>S/ {(row.centimos / 100).toFixed(2)}</td>
                <td>{row.estado}</td>
                <td>{row.modo}</td>
                <td>{dateTime(row.creadoEn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.length === 0 && <p>Todavía no hay compras registradas.</p>}
    </section>
  );
}
