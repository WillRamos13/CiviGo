import Link from "next/link";
import { MapPin, ShieldCheck, Route, ArrowUpRight } from "lucide-react";
import HomeVideo from '@/components/HomeVideo';
export default function Home() {
  return (
    <div className="page">
      <section className="home-film" aria-label="Conoce CiviGo">
        <h1 className="sr-only">CiviGo: tu ciudad, tu camino, más información</h1>
        <HomeVideo />
        <div className="actions" style={{margin: '16px 0 28px'}}>
            <Link href="/mapa" className="btn btn-primary">
              Explorar el mapa <ArrowUpRight size={17} />
            </Link>
            <Link href="/registro" className="btn btn-secondary">
              Sumarme a CiviGo
            </Link>
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
        Los niveles describen los reportes registrados. CiviGo ofrece
        información en la provincia de Ica.
      </p>
    </div>
  );
}
