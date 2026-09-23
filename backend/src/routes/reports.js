const express = require("express");
const router = express.Router();

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();


// Calcular distancia entre coordenadas

function distancia(lat1, lon1, lat2, lon2){

    const R = 6371000;

    const rad = Math.PI / 180;

    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;


    const a =
    Math.sin(dLat/2) *
    Math.sin(dLat/2) +

    Math.cos(lat1 * rad) *
    Math.cos(lat2 * rad) *

    Math.sin(dLon/2) *
    Math.sin(dLon/2);


    return R * 2 * Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1-a)
    );

}



// Obtener reportes

router.get("/", async(req,res)=>{

    try{

        const reportes =
        await prisma.report.findMany({
            orderBy:{
                fechaCreacion:"desc"
            }
        });


        res.json(reportes);


    }catch(error){

        console.log(error);

        res.status(500).json({
            error:"Error obteniendo reportes"
        });

    }

});





// Crear reporte

router.post("/", async(req,res)=>{

try{


const {

usuarioId,
tipo,
descripcion,
latitud,
longitud,
imagen

}=req.body;




// Buscar incidente cercano

const incidentes =
await prisma.incident.findMany({

where:{
tipo:tipo,
estado:"ACTIVO"
}

});



let incidenteEncontrado = null;



for(const incidente of incidentes){


const metros =
distancia(

latitud,
longitud,

incidente.latitud,
incidente.longitud

);



if(metros <= 100){

    incidenteEncontrado = incidente;
    break;

}


}





// Si existe incidente aumenta contador

if(incidenteEncontrado){


await prisma.incident.update({

where:{
id:incidenteEncontrado.id
},

data:{

totalReportes:{
increment:1
},


nivelRiesgo:{
increment:1
}


}

});



}



// Si no existe crea incidente nuevo

else{


incidenteEncontrado =
await prisma.incident.create({

data:{


tipo,

latitud,

longitud,

nivelRiesgo:1,

totalReportes:1,

estado:"ACTIVO"


}


});


}






// Crear reporte asociado


const nuevoReporte =
await prisma.report.create({

data:{


usuarioId,

incidenteId:
incidenteEncontrado.id,

tipo,

descripcion,

latitud,

longitud,

imagen


}

});





res.json({

mensaje:"Reporte creado",

reporte:nuevoReporte,

incidente:incidenteEncontrado

});



}catch(error){


console.log(error);


res.status(500).json({

error:"Error creando reporte"

});


}


});




module.exports = router;