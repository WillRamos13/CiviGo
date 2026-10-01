import Link from 'next/link';
export default function NotFound() { return <div className="page"><div className="card empty"><h1>Este camino no existe</h1><p>La página que buscas no se encuentra disponible.</p><Link className="btn btn-primary" href="/mapa">Volver al mapa</Link></div></div>; }
