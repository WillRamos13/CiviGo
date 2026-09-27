const express = require("express");
const router = express.Router();

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

router.get("/", async(req,res)=>{

    try{

        const incidentes = await prisma.incident.findMany({

            orderBy:{
                fechaCreacion:"desc"
            },

            include:{
                reportes:true
            }

        });

        res.json(incidentes);

    }catch(error){

        console.log(error.message);

        res.status(500).json({

            error:"Error obteniendo incidentes"

        });

    }

});

module.exports = router;