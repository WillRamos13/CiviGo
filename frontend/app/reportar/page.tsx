"use client";

import { useState } from "react";
import { crearReporte } from "@/lib/api";

const calcularRiesgo = (tipo:string)=>{

    const riesgos:any = {
        "Robo":3,
        "Intento de robo":2,
        "Accidente vehicular":2,
        "Incendio":3,
        "Humo o fuga de gas":3,
        "Persona desaparecida":2,
        "Persona sospechosa":2,
        "Pelea o disturbio":2,
        "Mala iluminación":1,
        "Bache":1,
        "Semáforo dañado":1,
        "Calle bloqueada":2,
        "Inundación":2,
        "Derrumbe":3,
        "Basura acumulada":0,
        "Animal peligroso":2,
        "Otro":2
    };

    return riesgos[tipo] ?? 1;
};

export default function ReportarPage() {


const [tipo,setTipo] = useState("");
const [descripcion,setDescripcion] = useState("");
const [imagen,setImagen] = useState("");

const [enviando,setEnviando] = useState(false);



const tipos = [

"Robo",
"Intento de robo",
"Accidente vehicular",
"Incendio",
"Humo o fuga de gas",
"Persona desaparecida",
"Persona sospechosa",
"Pelea o disturbio",
"Mala iluminación",
"Bache",
"Semáforo dañado",
"Calle bloqueada",
"Inundación",
"Derrumbe",
"Basura acumulada",
"Animal peligroso",
"Otro"

];




const enviarReporte = ()=>{


if(!tipo || !descripcion){

alert(
"Completa todos los campos"
);

return;

}



setEnviando(true);



navigator.geolocation.getCurrentPosition(

async(position)=>{


try{


const data = {


usuarioId:1,
tipo,
descripcion,
latitud: position.coords.latitude,
longitud: position.coords.longitude,
nivelRiesgo: calcularRiesgo(tipo),
estado:"Pendiente",
imagen
};



console.log(
"Enviando reporte:",
data
);



await crearReporte(data);



alert(
"Reporte enviado correctamente 🚀"
);



setTipo("");

setDescripcion("");

setImagen("");



}

catch(error){


console.error(error);


alert(
"Error enviando reporte"
);


}

finally{


setEnviando(false);


}



},


(error)=>{


console.error(error);


alert(
"Debes permitir la ubicación GPS"
);


setEnviando(false);


},


{

enableHighAccuracy:true,

timeout:10000,

maximumAge:0

}



);



};




return (

<div className="
min-h-screen
bg-slate-950
p-8
text-white
">


<div className="
max-w-xl
mx-auto
"
>


<h1 className="
text-3xl
font-bold
mb-6
">

🚨 Reportar incidente

</h1>



<div className="
bg-slate-900
rounded-2xl
p-6
space-y-5
">


<select

value={tipo}

onChange={(e)=>
setTipo(e.target.value)
}

className="
w-full
bg-slate-800
rounded-xl
p-3
outline-none
"

>


<option value="">

Selecciona tipo de incidente

</option>



{

tipos.map((item)=>(

<option
key={item}
value={item}
>

{item}

</option>

))

}



</select>





<textarea

value={descripcion}

onChange={(e)=>
setDescripcion(e.target.value)
}

placeholder="
Describe lo ocurrido...
"

className="
w-full
h-32
bg-slate-800
rounded-xl
p-3
resize-none
outline-none
"

/>





<input

value={imagen}

onChange={(e)=>
setImagen(e.target.value)
}

placeholder="
URL de imagen (opcional)
"

className="
w-full
bg-slate-800
rounded-xl
p-3
outline-none
"

/>





<div className="
bg-slate-800
rounded-xl
p-3
text-sm
text-slate-300
">

📍 Se utilizará tu ubicación actual para marcar el incidente en el mapa.

</div>





<button

onClick={enviarReporte}

disabled={enviando}

className="
w-full
bg-blue-600
hover:bg-blue-700
disabled:bg-slate-600
rounded-xl
p-3
font-bold
"

>


{

enviando

?

"Enviando reporte..."

:

"Enviar reporte 🚀"

}



</button>



</div>


</div>


</div>

);


}