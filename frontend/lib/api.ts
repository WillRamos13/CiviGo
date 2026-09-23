const API_URL = "http://localhost:4000/api";

export async function getReportes() {

    const res = await fetch(`${API_URL}/reports`);

    if (!res.ok) {
        throw new Error("Error cargando reportes");
    }

    return res.json();
}

export async function crearReporte(data: any) {

    const res = await fetch(`${API_URL}/reports`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
    });

    if (!res.ok) {
        throw new Error("Error creando reporte");
    }

    return res.json();
}