"use client";

import { useAuth } from "@/components/AuthProvider";
import { ManagementGate } from "./common";
import IncidentReviewPanel from "./IncidentReviewPanel";

function AgentReview() {
  const { usuario } = useAuth();
  const canReview = usuario?.permisos?.includes("revisar");
  return (
    <div className="page max-w-7xl">
      <div className="page-heading">
        <span className="badge">Agente de CiviGo</span>
        <h1 className="mt-3">Centro de revisión</h1>
        <p className="muted">Revisa los incidentes de {usuario?.distrito ?? "tu ámbito asignado"} según los permisos de tu cuenta.</p>
      </div>
      {canReview ? <IncidentReviewPanel /> : <section className="card">
        <h2 className="text-lg font-bold">Permisos pendientes</h2>
        <p className="muted mt-2">El administrador debe asignarte permisos y un ámbito de revisión antes de comenzar.</p>
      </section>}
    </div>
  );
}

export default function ManagementDashboard() {
  return <ManagementGate><AgentReview /></ManagementGate>;
}
