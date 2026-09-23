const express = require("express");
const router = express.Router();

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();


// REGISTRAR USUARIO

router.post("/register", async(req,res)=>{

    try{

        const {
            nombreUsuario,
            correo,
            telefono,
            password
        } = req.body;


        const usuario = await prisma.user.create({

            data:{
                nombreUsuario,
                correo,
                telefono,
                password,
                reputacion:100,
                rol:"USUARIO"
            }

        });


        res.json(usuario);


    }catch(error){

        console.log(error);

        res.status(500).json({
            error:error.message
        });

    }

});


module.exports = router;