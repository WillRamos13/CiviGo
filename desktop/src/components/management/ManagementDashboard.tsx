import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { hasAgentPermission } from "@/lib/agent-permissions";
import { ManagementGate, RemoteStatus, useRemote } from "./common";
import IncidentReviewPanel from "./IncidentReviewPanel";
import UsersPanel from "./UsersPanel";
import CatalogPanel from "./CatalogPanel";
import BusinessesPanel from "./BusinessesPanel";
import ConfigPanel from "./ConfigPanel";
import RewardsAdminPanel from "./RewardsAdminPanel";
import AppealsPanel from "./AppealsPanel";
import RecoveriesPanel from "./RecoveriesPanel";
import RankingAdminPanel from "./RankingAdminPanel";
import HistoricalImportPanel from "./HistoricalImportPanel";
import AuditPanel from "./AuditPanel";
import IntegrationsPanel from "./IntegrationsPanel";
import AnnouncementsPanel from "./AnnouncementsPanel";
import TrafficModerationPanel from "./TrafficModerationPanel";
import StatisticsPanel from "./StatisticsPanel";
import ContactPanel from "./ContactPanel";
import PaymentsPanel from "./PaymentsPanel";
import OperationsPanel from "./OperationsPanel";
import { ExcelExportToolbar } from "./ExcelExport";

type Tab =
  | "estadisticas"
  | "control"
  | "incidentes"
  | "apelaciones"
  | "usuarios"
  | "catalogo"
  | "negocios"
  | "anuncios"
  | "trafico"
  | "premios"
  | "ranking"
  | "recuperaciones"
  | "configuracion"
  | "historicos"
  | "actividad"
  | "integraciones"
  | "contacto"
  | "pagos";
const tabs: {
  id: Tab;
  label: string;
  adminOnly?: boolean;
  permission?: string;
}[] = [
  { id: "incidentes", label: "Incidentes", permission: "consultar" },
  { id: "estadisticas", label: "Estadísticas", adminOnly: true },
  { id: "control", label: "Control y rendimiento", adminOnly: true },
  { id: "apelaciones", label: "Apelaciones", adminOnly: true },
  { id: "usuarios", label: "Usuarios", adminOnly: true },

  { id: "catalogo", label: "Categorías y tipos", adminOnly: true },
  { id: "negocios", label: "Negocios", adminOnly: true },
  { id: "anuncios", label: "Anuncios y novedades", adminOnly: true },
  { id: "trafico", label: "Avisos de tráfico", adminOnly: true },
  { id: "premios", label: "Recompensas", adminOnly: true },
  { id: "ranking", label: "Cierre de ranking", adminOnly: true },
  { id: "recuperaciones", label: "Recuperaciones", adminOnly: true },
  { id: "historicos", label: "Antecedentes", adminOnly: true },
  { id: "configuracion", label: "Configuración", adminOnly: true },
  { id: "actividad", label: "Actividad y plazos", adminOnly: true },
  { id: "integraciones", label: "Integraciones", adminOnly: true },
  { id: "contacto", label: "Contáctanos · consultas", adminOnly: true },
  { id: "pagos", label: "Pagos Premium", adminOnly: true },
];
interface Overview {
  estadisticas: Record<string, number>;
  servicios?: {
    ia?: { configurado: boolean };

    correoGoogle?: { configurado: boolean };
  };
}

function OverviewPanel() {
  const { data, error, loading, reload } = useRemote<Overview>("/admin");
  const labels: Record<string, string> = {
    usuarios: "Usuarios registrados",
    incidentes: "Incidentes registrados",
    pendientes: "Pendientes de evaluación",
    activos: "Incidentes activos",
    flags: "Avisos por revisar",
    apelaciones: "Apelaciones pendientes",
    canjes: "Canjes pendientes",
    reportes: "Reportes recibidos",
    recuperaciones: "Recuperaciones pendientes",
  };
  return (
    <div className="mb-6">
      <div className="flex justify-end mb-3">
        <button
          className="btn btn-secondary"
          disabled={loading}
          onClick={reload}
        >
          {loading ? "Actualizando resumen…" : "Actualizar resumen"}
        </button>
      </div>
      <RemoteStatus loading={loading} error={error} retry={reload} />
      {data && !loading && !error && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Object.entries(data.estadisticas)
              .filter(([key]) => labels[key])
              .map(([key, value]) => (
                <div className="card" key={key}>
                  <p className="muted text-sm">{labels[key]}</p>
                  <p className="font-bold text-2xl mt-2">{value}</p>
                </div>
              ))}
          </div>
          {data.servicios && (
            <div className="flex flex-wrap gap-2 mt-4">
              <span className="badge">
                Evaluación IA:{" "}
                {data.servicios.ia?.configurado
                  ? "configurada"
                  : "pendiente de conexión"}
              </span>
              <span className="badge">
                Correo con Google:{" "}
                {data.servicios.correoGoogle?.configurado
                  ? "configurado"
                  : "pendiente de conexión"}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DashboardContent() {
  const { usuario } = useAuth();
  const admin = usuario?.rol.toUpperCase() === "ADMIN";
  const [active, setActive] = useState<Tab>("incidentes");
  const [overviewRevision, setOverviewRevision] = useState(0);
  const availableTabs = tabs.filter(
    (tab) =>
      admin ||
      (!tab.adminOnly &&
        (!tab.permission || hasAgentPermission(usuario, tab.permission))),
  );
  return (
    <div className="admin-workspace">
      <aside className="admin-sidebar">
        <strong className="admin-sidebar-title">Administración</strong>{" "}
        <nav
          aria-label="Herramientas de administración"
          className="admin-navigation"
        >
          {availableTabs.map((tab) => (
            <button
              key={tab.id}
              aria-current={active === tab.id ? "page" : undefined}
              className={`btn ${active === tab.id ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActive(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="page max-w-7xl admin-content">
        <div className="page-heading">
          <div>
            <span className="badge">
              {admin ? "Administración" : "Agente de CiviGo"}
            </span>
            <h1 className="mt-3">Centro de revisión</h1>
            <p className="muted">
              {admin
                ? "Gestiona la comunidad y los incidentes de CiviGo."
                : `Revisa la información de ${usuario?.distrito ?? "la provincia de Ica"} según tus permisos asignados.`}
            </p>
          </div>
        </div>
        {admin && !["estadisticas", "control"].includes(active) && (
          <OverviewPanel key={`${active}:${overviewRevision}`} />
        )}
        {admin && active === "estadisticas" && <ExcelExportToolbar />}
        {admin && active === "control" && <OperationsPanel />}

        {availableTabs.length === 0 ? (
          <section className="card">
            <h2 className="text-lg font-bold">Permisos pendientes</h2>
            <p className="muted mt-2">
              El administrador debe asignarte permisos y un ámbito de revisión
              antes de comenzar.
            </p>
          </section>
        ) : (
          <>
            {active === "incidentes" && (
              <IncidentReviewPanel
                onChanged={() =>
                  setOverviewRevision((revision) => revision + 1)
                }
              />
            )}
            {admin && active === "apelaciones" && <AppealsPanel />}
            {admin && active === "estadisticas" && <StatisticsPanel />}
            {admin && active === "usuarios" && <UsersPanel />}

            {admin && active === "catalogo" && <CatalogPanel />}
            {admin && active === "negocios" && <BusinessesPanel />}
            {admin && active === "anuncios" && <AnnouncementsPanel />}
            {admin && active === "trafico" && <TrafficModerationPanel />}
            {admin && active === "premios" && <RewardsAdminPanel />}
            {admin && active === "ranking" && <RankingAdminPanel />}
            {admin && active === "recuperaciones" && <RecoveriesPanel />}
            {admin && active === "historicos" && <HistoricalImportPanel />}
            {admin && active === "configuracion" && <ConfigPanel />}
            {admin && active === "actividad" && <AuditPanel />}
            {admin && active === "integraciones" && <IntegrationsPanel />}
            {admin && active === "contacto" && <ContactPanel />}
            {admin && active === "pagos" && <PaymentsPanel />}
          </>
        )}
      </div>
    </div>
  );
}

export default function ManagementDashboard({
  administrator = false,
}: {
  administrator?: boolean;
}) {
  return (
    <ManagementGate administrator={administrator}>
      <DashboardContent />
    </ManagementGate>
  );
}
