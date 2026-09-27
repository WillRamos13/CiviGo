const express = require("express");
const router = express.Router();

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();


// Obtener incidentes para el mapa

router.get("/", async(req,res)=>{

    try{


        const incidentes = await prisma.incident.findMany({

            orderBy:{
                fechaCreacion:"desc"
            },


            include:{

                _count:{

                    select:{
                        reportes:true
                    }

                }

            }


        });



        const respuesta = incidentes.map((incidente)=>({


            id: incidente.id,


            tipo: incidente.tipo,


            latitud: incidente.latitud,


            longitud: incidente.longitud,


            nivelRiesgo:
            incidente.nivelRiesgo,


            estado:
            incidente.estado,


            totalReportes:
            incidente._count.reportes,


            fechaCreacion:
            incidente.fechaCreacion



        }));



        res.json(respuesta);



    }catch(error){


        console.log(error.message);


        res.status(500).json({

            error:"Error obteniendo incidentes"

        });


    }


});


module.exports = router;