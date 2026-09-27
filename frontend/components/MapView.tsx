"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import RiskLegend from "./RiskLegend";

import "mapbox-gl/dist/mapbox-gl.css";


mapboxgl.accessToken =
process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";



const tiposReporte:any = {

"Robo":{
icono:"🚨"
},

"Intento de robo":{
icono:"⚠️"
},

"Accidente vehicular":{
icono:"🚗"
},

"Incendio":{
icono:"🔥"
},

"Humo o fuga de gas":{
icono:"💨"
},

"Persona desaparecida":{
icono:"🔎"
},

"Persona sospechosa":{
icono:"👤"
},

"Pelea o disturbio":{
icono:"⚔️"
},

"Mala iluminación":{
icono:"💡"
},

"Bache":{
icono:"🕳️"
},

"Semáforo dañado":{
icono:"🚦"
},

"Calle bloqueada":{
icono:"🚧"
},

"Inundación":{
icono:"🌊"
},

"Derrumbe":{
icono:"⛰️"
},

"Basura acumulada":{
icono:"🗑️"
},

"Animal peligroso":{
icono:"🐕"
},

"Otro":{
icono:"⚠️"
}

};



function obtenerReporte(tipo:string){

return tiposReporte[tipo] || tiposReporte["Otro"];

}





export default function MapView(){


const mapContainer =
useRef<HTMLDivElement|null>(null);


const mapRef =
useRef<mapboxgl.Map|null>(null);


const markersRef =
useRef<mapboxgl.Marker[]>([]);


const incidentIdsRef =
useRef<number[]>([]);





const [mostrarRiesgo,setMostrarRiesgo] =
useState(true);


const [mostrarEventos,setMostrarEventos] =
useState(true);






// NUEVA ESCALA 0 - 5

const colorRiesgo=(nivel:number)=>{


if(nivel===5)
return "#7c3aed"; // crítico


if(nivel===4)
return "#ef4444"; // alto


if(nivel===3)
return "#f97316"; // moderado


if(nivel===2)
return "#eab308"; // bajo


if(nivel===1)
return "#22c55e"; // seguro


return "#94a3b8"; // sin datos


};






const confirmarReporte = async(id:number)=>{


try{


const response =

await fetch(

`http://localhost:4000/api/reports/${id}/confirmar`,

{

method:"PUT"

}

);




const data =
await response.json();



console.log(
"Confirmado:",
data
);



alert(
"Incidente confirmado 👍"
);



}

catch(error){


console.error(
"Error confirmando:",
error
);


}


};





const cargarIncidentes = async(map:mapboxgl.Map)=>{


try{


const response =

await fetch(

"http://localhost:4000/api/incidents"

);



const incidents =

await response.json();




console.log(
"Incidentes recibidos:",
incidents
);





incidents.forEach((incident:any)=>{



if(
incidentIdsRef.current.includes(
incident.id
)
){

return;

}






const config =

obtenerReporte(
incident.tipo
);





const elemento =

document.createElement("div");





elemento.innerHTML = `


<div style="

background:white;

width:50px;

height:50px;

border-radius:50%;

display:flex;

align-items:center;

justify-content:center;

font-size:32px;

box-shadow:0 4px 12px rgba(0,0,0,0.35);

border:3px solid ${colorRiesgo(
incident.nivelRiesgo || 0
)};

">


${config.icono}


</div>


`;



elemento.style.cursor="pointer";





const popup =

new mapboxgl.Popup({

offset:25

})

.setHTML(`


<div>


<h3 style="
font-weight:bold;
font-size:17px;
">


${config.icono}

${incident.tipo}


</h3>


<p>

Estado:

${incident.estado || "ACTIVO"}

</p>


<p>

Nivel de riesgo:

${incident.nivelRiesgo || 0}

</p>


<p>

Reportes:

${incident.totalReportes || 0}

</p>


<button

id="confirmar-${incident.id}"

style="

background:#2563eb;

color:white;

padding:8px 12px;

border-radius:8px;

margin-top:10px;

cursor:pointer;

border:none;

"

>

👍 Confirmar incidente

</button>


<p>

${incident.descripcion || "Sin descripción"}

</p>


${
incident.imagen

?

`<img src="${incident.imagen}" width="180"/>`

:

""

}



</div>


`);
popup.on(
"open",
()=>{


const boton =

document.getElementById(

`confirmar-${incident.id}`

);



if(boton){


boton.onclick=()=>{


confirmarReporte(
incident.id
);


};


}



}

);






const marker =

new mapboxgl.Marker(elemento)


.setLngLat([

incident.longitud,

incident.latitud

])


.setPopup(popup)


.addTo(map);






markersRef.current.push(marker);



incidentIdsRef.current.push(
incident.id
);



});



}

catch(error){


console.error(

"Error cargando incidentes:",

error

);


}


};








useEffect(()=>{


if(!mapContainer.current)

return;





const map =

new mapboxgl.Map({


container:

mapContainer.current,



style:

"mapbox://styles/mapbox/streets-v12",



center:[

-77.0428,

-12.0464

],



zoom:13


});





mapRef.current = map;





map.addControl(

new mapboxgl.NavigationControl()

);







map.on(

"load",

async()=>{



await cargarIncidentes(map);





// ACTUALIZACIÓN CADA 10 SEGUNDOS

const intervalo =

setInterval(()=>{


cargarIncidentes(map);


},10000);







const response =

await fetch(

"http://localhost:4000/api/incidents"

);



const incidents =

await response.json();








const geojson:any = {


type:"FeatureCollection",


features:

incidents.map((incident:any)=>({



type:"Feature",



geometry:{



type:"Point",



coordinates:[


incident.longitud,


incident.latitud


]


},



properties:{


nivel:

incident.nivelRiesgo || 0


}


}))



};







map.addSource(

"riesgo",

{


type:"geojson",


data:geojson


}


);









map.addLayer({



id:"capa-riesgo",



type:"circle",



source:"riesgo",



paint:{





"circle-radius":30,



"circle-opacity":0.35,






// NUEVA ESCALA 0-5

"circle-color":[



"match",



[

"get",

"nivel"

],




0,

"#94a3b8",



1,

"#22c55e",



2,

"#eab308",



3,

"#f97316",



4,

"#ef4444",



5,

"#7c3aed",




"#94a3b8"



]



}



});







return()=>{


clearInterval(intervalo);



map.remove();



};




});



},[]);









useEffect(()=>{


const map =

mapRef.current;



if(!map)

return;





if(

map.getLayer("capa-riesgo")

){



map.setLayoutProperty(


"capa-riesgo",



"visibility",



mostrarRiesgo

?

"visible"

:

"none"



);



}



},[mostrarRiesgo]);









useEffect(()=>{



if(!mapRef.current)

return;





markersRef.current.forEach(marker=>{



if(mostrarEventos){



marker.addTo(

mapRef.current!

);



}

else{



marker.remove();



}



});



},[mostrarEventos]);









return(



<div className="

w-full

h-full

relative

">






<div

ref={mapContainer}


className="

w-full

h-full

"

/>








<div className="

absolute

top-5

right-5

bg-slate-900

text-white

p-4

rounded-xl

space-y-3

">





<label className="

flex

gap-2

items-center

">


<input


type="checkbox"


checked={mostrarRiesgo}



onChange={(e)=>

setMostrarRiesgo(

e.target.checked

)

}


/>


Capa de riesgo


</label>









<label className="

flex

gap-2

items-center

">



<input


type="checkbox"



checked={mostrarEventos}



onChange={(e)=>

setMostrarEventos(

e.target.checked

)

}


/>


Eventos


</label>





</div>








<RiskLegend />






</div>



);



}