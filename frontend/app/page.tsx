import Link from "next/link";
import { MapPin, ShieldCheck, Route, ArrowUpRight } from "lucide-react";
import HomeVideo from '@/components/HomeVideo';
export default function Home() {
  return (
    <div className="page">
      <section className="hero">
        <div>
          <span className="badge">ICA, CONECTADA POR SU GENTE</span>
          <h1>
            Tu ciudad.
            <br />
            Tu camino.
            <br />
            <em>Más información.</em>
          </h1>
          <p>
            Conoce lo que pasa en tu entorno, comparte incidentes y elige un
            recorrido según los reportes disponibles.
          </p>
          <div className="actions">
            <Link href="/mapa" className="btn btn-primary">
              Explorar el mapa <ArrowUpRight size={17} />
            </Link>
            <Link href="/registro" className="btn btn-secondary">
              Sumarme a CiviGo
            </Link>
          </div>
          <div className="stats-row">
            <div className="stat">
              <strong>Ica</strong>
              <span>Provincia de cobertura</span>
            </div>
            <div className="stat">
              <strong>3</strong>
              <span>Formas de recorrer tu ciudad</span>
            </div>
            <div className="stat">
              <strong>50 m</strong>
              <span>Confirmaciones cerca del incidente</span>
            </div>
          </div>
        </div>
        <HomeVideo />
      </section>
      <div className="grid-3">
        <div className="card">
          <ShieldCheck color="var(--brand)" size={26} />
          <h3 style={{ marginTop: 15 }}>Información con contexto</h3>
          <p className="muted">
            La gravedad de un incidente, su validación y su antigüedad
            determinan su aporte al tramo de calle.
          </p>
        </div>
        <div className="card">
          <Route color="var(--brand)" size={26} />
          <h3 style={{ marginTop: 15 }}>La decisión es tuya</h3>
          <p className="muted">
            CiviGo informa de incidentes importantes durante el recorrido. Tú
            eliges si deseas buscar otra ruta.
          </p>
        </div>
        <div className="card">
          <MapPin color="var(--brand)" size={26} />
          <h3 style={{ marginTop: 15 }}>Privacidad al participar</h3>
          <p className="muted">
            La comunidad ve tu nickname. Las pruebas de delitos se reservan al
            personal autorizado.
          </p>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 11 }}>
        Los niveles describen los reportes registrados. CiviGo ofrece
        información en la provincia de Ica.
      </p>
    </div>
  );
}
