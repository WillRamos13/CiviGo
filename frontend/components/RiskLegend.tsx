export default function RiskLegend() {

  const risks = [
    {
      color: "bg-green-500",
      text: "Seguro - 0 puntos"
    },
    {
      color: "bg-yellow-400",
      text: "Bajo - 1 punto"
    },
    {
      color: "bg-orange-500",
      text: "Medio - 2 puntos"
    },
    {
      color: "bg-red-500",
      text: "Alto - 3 puntos"
    }
  ];


  return (

    <div className="absolute top-5 left-5 bg-white p-4 rounded-xl shadow-lg">

      <h3 className="font-bold mb-3">
        Nivel de riesgo
      </h3>


      {risks.map((risk)=>(

        <div
          key={risk.text}
          className="flex items-center gap-3 mb-2"
        >

          <div
            className={`w-4 h-4 rounded-full ${risk.color}`}
          />

          <span>
            {risk.text}
          </span>

        </div>

      ))}

    </div>

  );

}