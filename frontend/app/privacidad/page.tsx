import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = {
  title: "Privacidad",
  description: "Información sobre los datos usados por CiviGo.",
  alternates: { canonical: "/privacidad" },
};
export default function Privacy() {
  return (
    <section
      className="card"
      style={{ maxWidth: 850, margin: "24px auto", lineHeight: 1.8 }}
    >
      <h1>Tu información en CiviGo</h1>
      <p>
        CiviGo usa la información de tu cuenta para identificar tus aportes,
        verificar el correo y aplicar los permisos de ciudadanos, agentes y
        administradores.
      </p>
      <h2>Ubicación y recorridos</h2>
      <p>
        El mapa solicita permiso para obtener tu ubicación. Se utiliza para
        ubicarte, calcular recorridos y mostrar información cercana. Puedes
        retirar ese permiso desde tu navegador. Los recorridos guardados y el
        historial se vinculan con tu cuenta cuando utilizas esas funciones; las
        copias locales permanecen en el navegador según la opción elegida.
      </p>
      <h2>Reportes y archivos</h2>
      <p>
        El tipo, descripción, fecha y ubicación del incidente pueden formar
        parte de la consulta pública. Las evidencias privadas se reservan al
        personal autorizado. Evita incluir datos personales de otras personas en
        la descripción o en las fotografías públicas.
      </p>
      <h2>Proveedores</h2>
      <p>
        Los mapas y búsquedas pueden enviar coordenadas o consultas a los
        proveedores configurados, como Mapbox, TomTom y Foursquare. Las
        consultas al asistente y la evaluación de reportes pueden procesarse con
        OpenAI. Los correos se envían con el proveedor configurado y los pagos
        se completan en Mercado Pago; CiviGo no recibe los números de tu
        tarjeta.
      </p>
      <h2>Spotify opcional</h2>
      <p>
        La conexión solo se inicia cuando la autorizas. Permite consultar la
        canción y el dispositivo que estás usando; los controles, cuando estén
        habilitados y autorizados, requieren permisos adicionales. No se
        solicita tu correo de Spotify ni acceso a tu biblioteca. Los tokens
        permanecen en memoria y se eliminan al desvincular o recargar la página.
        Durante la autorización se guarda temporalmente la comprobación PKCE en
        esta pestaña, y se consume una sola vez.
      </p>
      <p>
        Puedes desvincular Spotify desde Tu música y revocar el permiso en{" "}
        <a
          href="https://www.spotify.com/account/apps/"
          target="_blank"
          rel="noopener noreferrer"
        >
          tus aplicaciones de Spotify
        </a>
        .
      </p>
      <h2>Mediciones</h2>
      <p>
        CiviGo registra mediciones operativas para conocer disponibilidad y
        rendimiento. La analítica opcional de producto, cuando está configurada,
        excluye coordenadas precisas, contenido de mensajes, formularios y
        evidencias. Respeta las señales de No rastrear y Global Privacy Control
        del navegador.
      </p>
      <h2>Consultas sobre tus datos</h2>
      <p>
        Para solicitar acceso, corrección o eliminación de tus datos, utiliza{" "}
        <Link href="/contactanos">Contáctanos</Link>. No incluyas contraseñas ni
        información de tarjetas. La solicitud puede requerir una comprobación de
        identidad para proteger la cuenta.
      </p>
      <p>
        Esta página describe las funciones actuales. La identificación formal
        del responsable, los plazos de conservación y el procedimiento legal de
        atención deben completarse antes del lanzamiento comercial.
      </p>
    </section>
  );
}
