'use client';
import Link from 'next/link';
import { Fragment } from 'react';
import { useAuth } from './AuthProvider';
import { canParticipate } from '@/lib/session';
export default function AuthGate({ children, participation = false }: {
    children: React.ReactNode;
    participation?: boolean;
}) { const { usuario, loading,offline } = useAuth(); if (loading)
    return <div className="card">Comprobando tu sesión…</div>;if(offline)return <div className="card empty"><h2>Consulta local de recorridos</h2><p>La sesión y los datos personales necesitan conexión con CiviGo. Puedes consultar las copias de recorridos que guardaste en este dispositivo.</p><Link className="btn btn-primary" href="/mapa">Ver recorridos guardados</Link></div>; if (!usuario)
    return <div className="card empty"><h2>Participa en CiviGo</h2><p>Inicia sesión o crea una cuenta para usar esta función.</p><Link className="btn btn-primary" href="/ingresar">Iniciar sesión</Link></div>; if(participation&&usuario.bloqueado)return <div className="card empty"><h2>Tu cuenta tiene una restricción</h2><p>Puedes consultar tus reportes y solicitar una revisión de las decisiones.</p><Link className="btn btn-primary" href="/mis-reportes">Ver mis reportes</Link></div>; if (participation && !canParticipate(usuario))
    return <div className="card empty"><h2>Verifica tu Gmail para participar</h2><p>Puedes consultar el mapa y calcular rutas. Para reportar, confirmar y conversar, comprueba tu Gmail con Google.</p><Link className="btn btn-primary" href="/verificar">Verificar Gmail con Google</Link></div>; return <Fragment key={usuario.id}>{children}</Fragment>; }
