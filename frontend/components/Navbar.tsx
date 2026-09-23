export default function Navbar() {
  return (
    <nav className="flex justify-between items-center px-8 py-5 bg-white shadow">

      <div className="flex items-center gap-3">
        <div className="bg-green-500 text-white rounded-full p-2">
          🛡️
        </div>

        <h1 className="text-2xl font-bold text-slate-900">
          CiviGo
        </h1>
      </div>


      <div className="flex gap-4">

        <button className="text-slate-700">
          Iniciar sesión
        </button>

        <button className="bg-blue-600 text-white px-5 py-2 rounded-lg">
          Registrarse
        </button>

      </div>

    </nav>
  );
}