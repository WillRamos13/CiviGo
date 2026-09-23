import Navbar from "@/components/Navbar";
import MapView from "@/components/MapView";


export default function Home() {

  return (

    <main className="min-h-screen bg-slate-50">

      <Navbar />


      <section className="text-center mt-20">

        <h2 className="text-5xl font-bold text-slate-900">
          Encuentra rutas más seguras
        </h2>


        <p className="mt-5 text-gray-600 text-lg">
          CiviGo analiza el nivel de riesgo
          de las calles para ayudarte a elegir
          mejores caminos.
        </p>


      </section>

      <section className="px-10 mt-10">
        <h2 className="text-3xl font-bold mb-5">
          Mapa de Rutas Seguras
        </h2>
        <MapView />
      </section>

    </main>

  );
}