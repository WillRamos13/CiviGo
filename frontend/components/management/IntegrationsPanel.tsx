'use client';
import { RemoteStatus, useRemote } from './common';

interface IntegrationReport {
    proveedores: { id: string; nombre: string; configurado: boolean; variablesPendientes: string[]; indicacion: string; aviso?: string }[];
    frontend: { plataforma: string; variables: string[]; indicacion: string };
    navegacion: string;
    pagos: string;
}

export default function IntegrationsPanel() {
    const { data, error, loading, reload } = useRemote<IntegrationReport>('/admin/integrations');
    return <section>
        <div className="card-header"><h2>Integraciones del proyecto</h2><button className="btn btn-secondary btn-small" disabled={loading} onClick={reload}>Actualizar estado</button></div>
        <p className="notice">Este estado comprueba la configuración del servidor. La activación, el saldo y las llamadas reales se verifican con cada proveedor. Las claves se administran en Railway y Vercel.</p>
        <RemoteStatus loading={loading} error={error} retry={reload} />
        {data && !loading && !error && <>
            <div className="grid-2">{data.proveedores.map(provider => <article key={provider.id} className="card">
                <div className="card-header"><h3>{provider.nombre}</h3><span className="badge">{provider.configurado ? 'Configuración presente' : 'Pendiente de configurar'}</span></div>
                <p className="muted">{provider.indicacion}</p>
                {provider.variablesPendientes.length > 0 && <p style={{ fontSize: 12, overflowWrap: 'anywhere' }}><strong>Variables pendientes:</strong> {provider.variablesPendientes.join(', ')}</p>}
                {provider.aviso && <p className="notice notice-warning">{provider.aviso}</p>}
            </article>)}</div>
            <article className="card"><h3>Mapa y navegación</h3><p>{data.navegacion}</p><p className="muted">{data.frontend.indicacion}</p><p style={{ fontSize: 12 }}>Variables de {data.frontend.plataforma}: {data.frontend.variables.join(', ')}.</p></article>
            <p className="muted">{data.pagos}</p>
        </>}
    </section>;
}
