"use client";

import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

const features = [
  ["Rutas favoritas", "Hasta 3", "Hasta 20, con nombres y etiquetas"],
  ["Recorridos guardados", "Último recorrido", "Varios recorridos"],
  ["Historial personal", "Consulta básica", "Filtros y estadísticas"],
  ["Publicidad", "Recomendaciones y anuncios", "Puedes ocultarlos"],
  ["Reportes, chats y confirmaciones", "Incluidos", "Incluidos"],
  ["Rutas y avisos de incidentes", "Incluidos", "Incluidos"],
];

export default function PremiumPage() {
  const { usuario, loading } = useAuth();
  return (
    <div className="page max-w-5xl">
      <div className="page-heading">
        <div>
          <span className="badge">Demostración</span>
          <h1 className="mt-3">CiviGo Premium</h1>
          <p className="muted">
            Organiza tus recorridos y personaliza tu experiencia.
          </p>
        </div>
      </div>
      <section className="card mb-6 brand-border brand-surface">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div>
            <h2 className="text-2xl font-bold">
              S/5,90{" "}
              <span className="text-base font-normal muted">
                al mes · precio de referencia
              </span>
            </h2>
            <p className="mt-2">
              Durante el piloto no hay cobros ni suscripciones automáticas.
            </p>
          </div>
          <span className="badge">
            {!loading && usuario?.premium
              ? "Premium de demostración activo"
              : "Plan gratuito"}
          </span>
        </div>
        <p className="muted mt-4">
          Un administrador puede activar Premium en cuentas del piloto. Su
          activación no genera un pago.
        </p>
      </section>
      <section className="card overflow-x-auto">
        <h2 className="text-xl font-bold mb-4">Elige cómo usar CiviGo</h2>
        <table className="w-full min-w-[550px] text-left">
          <caption className="sr-only">
            Comparación de planes gratuito y Premium
          </caption>
          <thead>
            <tr className="border-b">
              <th className="p-3">Función</th>
              <th className="p-3">Gratis</th>
              <th className="p-3 brand-text">Premium</th>
            </tr>
          </thead>
          <tbody>
            {features.map(([name, free, premium]) => (
              <tr key={name} className="border-b last:border-0">
                <th scope="row" className="p-3 font-medium">
                  {name}
                </th>
                <td className="p-3">{free}</td>
                <td className="p-3">{premium}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="notice mt-6">
        Todos reciben la misma información de seguridad y el mismo cálculo de
        rutas. Premium no modifica la credibilidad, el ranking ni las monedas.
      </p>
      <div className="flex flex-wrap gap-3 mt-5">
        <Link href="/mapa" className="btn btn-primary">
          Explorar el mapa
        </Link>
        <Link
          href={usuario ? "/perfil" : "/registro"}
          className="btn btn-secondary"
        >
          {usuario ? "Ver mi cuenta" : "Crear una cuenta"}
        </Link>
      </div>
    </div>
  );
}
