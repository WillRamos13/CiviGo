"use client";

import { useState } from "react";


export default function RiskLegend() {


  const [mostrar, setMostrar] = useState(false);



  const risks = [

    {
      color: "bg-gray-400",
      text: "Sin datos - Nivel 0"
    },

    {
      color: "bg-green-500",
      text: "Seguro - Nivel 1"
    },

    {
      color: "bg-yellow-400",
      text: "Bajo - Nivel 2"
    },

    {
      color: "bg-orange-500",
      text: "Moderado - Nivel 3"
    },

    {
      color: "bg-red-500",
      text: "Alto - Nivel 4"
    },

    {
      color: "bg-purple-600",
      text: "Crítico - Nivel 5"
    }

  ];



  return (

    <div className="
      absolute
      bottom-5
      left-5
      z-10
    ">


      <button

        onClick={()=>setMostrar(!mostrar)}

        className="
          bg-white
          shadow-lg
          rounded-xl
          px-4
          py-2
          font-semibold
          text-sm
          hover:bg-gray-100
        "

      >

        🛈 Riesgo

      </button>





      {
        mostrar && (

          <div className="
            mt-3
            bg-white
            p-4
            rounded-xl
            shadow-lg
            w-56
          ">


            <h3 className="
              font-bold
              mb-3
            ">

              Nivel de riesgo

            </h3>



            {
              risks.map((risk)=>(


                <div

                  key={risk.text}

                  className="
                    flex
                    items-center
                    gap-3
                    mb-2
                    text-sm
                  "

                >


                  <div

                    className={`
                      w-4
                      h-4
                      rounded-full
                      ${risk.color}
                    `}

                  />


                  <span>

                    {risk.text}

                  </span>


                </div>


              ))

            }



          </div>

        )
      }



    </div>

  );

}