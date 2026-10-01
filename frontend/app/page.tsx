import Link from "next/link";
import Image from "next/image";
import { MapPin, ShieldCheck, Route, Users, ArrowUpRight } from "lucide-react";
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
              <span>Provincia de cobertura inicial</span>
            </div>
            <div className="stat">
              <strong>3</strong>
              <span>Formas de recorrer tu ciudad</span>
            </div>
            <div className="stat">
              <strong>100</strong>
              <span>Participantes previstos en el piloto</span>
            </div>
          </div>
        </div>
        <div className="hero-visual">
          <div className="hero-brand">
            <Image
              src="/civigo-logo.jpeg"
              alt="CiviGo"
              width={130}
              height={156}
              unoptimized
              loading="eager"
            />
          </div>
          <div className="hero-visual-card">
            <div className="section-title">
              <span className="brand-icon">
                <Route />
              </span>
              <h3>Elige cómo llegar</h3>
            </div>
            <p>
              Camina, pedalea o conduce. Compara distancia, tiempo y exposición
              a incidentes.
            </p>
          </div>
          <div className="hero-visual-card">
            <div className="section-title">
              <span className="brand-icon">
                <MapPin />
              </span>
              <h3>Comparte lo que sucede</h3>
            </div>
            <p>
              Reportes organizados por categorías, ubicación y evidencias, con
              revisión de agentes.
            </p>
          </div>
          <div className="hero-visual-card">
            <div className="section-title">
              <span className="brand-icon">
                <Users />
              </span>
              <h3>Construimos en comunidad</h3>
            </div>
            <p>
              Confirmaciones cercanas, participación y recompensas en
              demostración.
            </p>
          </div>
        </div>
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
        Proyecto académico en desarrollo. Los niveles describen los reportes
        registrados; la cobertura inicial corresponde a la provincia de Ica.
      </p>
    </div>
  );
}
