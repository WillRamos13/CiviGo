'use client';
export default function ErrorPage({ reset }: {
    error: Error;
    reset: () => void;
}) { return <div className="page"><div className="card empty"><h1>No pudimos cargar esta página</h1><p>Inténtalo nuevamente. Tus datos guardados no se modificaron.</p><button className="btn btn-primary" onClick={reset}>Volver a intentar</button></div></div>; }
