'use client';
import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import IncidentPanel from '@/components/IncidentPanel';
import { useAuth } from '@/components/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import type { Incidente } from '@/lib/types';
export default function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { usuario, loading } = useAuth();
    if (loading) return <div className="page"><div className="card">Comprobando tu sesión…</div></div>;
    return <IncidentDetail key={`${id}:${usuario?.id ?? 'publico'}`} id={id} />;
}

function IncidentDetail({ id }: { id: string }) {
    const router = useRouter();
    const [data, setData] = useState<Incidente | null>(null), [error, setError] = useState('');
    useEffect(() => {
        const controller = new AbortController();
        api<Incidente>(`/incidents/${encodeURIComponent(id)}`, { signal: controller.signal })
            .then(value => { if (!controller.signal.aborted) setData(value); })
            .catch(reason => { if (!controller.signal.aborted) setError(errorMessage(reason)); });
        return () => controller.abort();
    }, [id]);
    return <div className="page">{error
        ? <div className="notice notice-error" role="alert">{error}</div>
        : data
            ? <IncidentPanel incidente={data} onClose={() => router.push('/mapa')} onRefresh={() => { }} />
            : <div className="card">Cargando incidente…</div>}</div>;
}
