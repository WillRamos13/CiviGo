"use client";

import { useEffect, useState } from "react";


export default function RightPanel(){

const [incidents,setIncidents] = useState<any[]>([]);
const [loading,setLoading] = useState(true);



useEffect(()=>{


fetch("http://localhost:4000/api/incidents")


.then((res)=>{

if(!res.ok){

throw new Error("Error obteniendo incidentes");

}

return res.json();

})


.then((data)=>{

setIncidents(data);

})


.catch((error)=>{

console.error(
"Error cargando incidentes:",
error
);

})


.finally(()=>{

setLoading(false);

});


},[]);




return (

<aside

className="
w-96
min-h-screen
bg-slate-950
border-l
border-slate-800
p-5
space-y-5
"

>


{/* PLANIFICAR RUTA */}


<div

className="
bg-slate-900
border
border-slate-800
rounded-2xl
p-5
"

>


<h2

className="
text-xl
font-bold
text-white
"

>

📍 Planifica tu ruta

</h2>


<p

className="
text-sm
text-slate-400
mb-5
"

>

Muévete de forma más segura

</p>



<div

className="
bg-slate-950
rounded-xl
p-4
mb-3
"

>

<p className="text-blue-400 text-sm">

Origen

</p>


<p className="text-white">

Selecciona un punto de partida

</p>


</div>




<div

className="
bg-slate-950
rounded-xl
p-4
mb-5
"

>

<p className="text-red-400 text-sm">

Destino

</p>


<p className="text-white">

Selecciona un destino

</p>


</div>




<button

className="
w-full
bg-blue-600
hover:bg-blue-700
rounded-xl
py-3
font-bold
text-white
"

>

🚀 Trazar ruta

</button>



</div>





{/* INCIDENTES RECIENTES */}


<div

className="
bg-slate-900
border
border-slate-800
rounded-2xl
p-5
"

>


<h2

className="
text-xl
font-bold
text-white
mb-4
"

>

📋 Incidentes recientes

</h2>




{

loading ? (


<p className="text-slate-400">

Cargando incidentes...

</p>


)

:


incidents.length === 0 ? (


<p className="text-slate-400">

No hay incidentes registrados

</p>


)

:


(

<div className="space-y-3">


{

incidents.map((incident)=>(


<div

key={incident.id}

className="
bg-slate-950
rounded-xl
p-4
border
border-slate-800
"

>


<p

className="
text-white
font-bold
"

>

🚨 {incident.tipo}

</p>




<p

className="
text-sm
text-slate-400
mt-2
"

>

📍 Reportes recibidos:
{" "}
<span className="text-white">

{incident.totalReportes}

</span>

</p>




<p

className="
text-xs
text-orange-400
mt-3
"

>

Estado:
{" "}
{incident.estado}

</p>




<p

className="
text-xs
text-yellow-400
mt-1
"

>

Nivel de riesgo:
{" "}
{incident.nivelRiesgo}

</p>



</div>


))

}


</div>

)

}


</div>



</aside>


);


}