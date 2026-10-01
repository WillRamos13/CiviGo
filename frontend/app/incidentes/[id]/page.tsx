'use client';
import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import IncidentPanel from '@/components/IncidentPanel';
import { api, errorMessage } from '@/lib/api';
import type { Incidente } from '@/lib/types';
export default function Page({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { const { id } = use(params); const router = useRouter(); const [data, setData] = useState<Incidente | null>(null), [error, setError] = useState(''); useEffect(() => { let ok = true; api<Incidente>(`/incidents/${encodeURIComponent(id)}`).then(r => { if (ok)
    setData(r); }).catch(e => { if (ok)
    setError(errorMessage(e)); }); return () => { ok = false; }; }, [id]); return <div className="page">{error ? <div className="notice notice-error" role="alert">{error}</div> : data ? <IncidentPanel incidente={data} onClose={() => router.push('/mapa')} onRefresh={() => { }}/> : <div className="card">Cargando incidente…</div>}</div>; }
