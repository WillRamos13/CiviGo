const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());


app.get("/", (req,res)=>{
    res.json({
        message:"API CiviGo funcionando 🚀"
    });
});


// RUTAS

const incidentsRoutes = require("./routes/incidents");
const reportsRoutes = require("./routes/reports");
const usersRoutes = require("./routes/users");


app.use("/api/incidents", incidentsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/users", usersRoutes);



const PORT = process.env.PORT || 4000;


app.listen(PORT, ()=>{

    console.log(
        `Servidor CiviGo corriendo en puerto ${PORT}`
    );

});