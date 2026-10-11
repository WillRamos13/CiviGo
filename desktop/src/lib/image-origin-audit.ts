export interface ImageReference {
  url: string;
  host: string;
  tipo: "COMPLETA" | "PARCIAL" | "PAGINA";
}

export interface ImageOriginEvidence {
  adjuntoId: string;
  resultado: "COINCIDENCIA_WEB" | "SIN_COINCIDENCIAS" | "NO_COMPROBADA";
  motivo: string;
  referencias: ImageReference[];
}

export interface ImageOriginAudit {
  habilitado: boolean;
  requiereRevision: boolean;
  evidencias: ImageOriginEvidence[];
}

// Renderer validation is also enforced by the dedicated Electron IPC policy.
export function imageReferenceUrl(
  value: unknown,
): { url: string; host: string } | null {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\\\x00-\x20\x7f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes(".") ||
      !/^[a-z0-9.-]+$/.test(host) ||
      /^\d+(?:\.\d+){3}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|test|invalid|example)$/.test(
        host,
      ) ||
      host
        .split(".")
        .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    )
      return null;
    url.hostname = host;
    url.hash = "";
    return { url: url.href, host };
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readImageOriginAudit(value: unknown): ImageOriginAudit | null {
  const audit = record(value);
  if (
    !audit ||
    typeof audit.habilitado !== "boolean" ||
    typeof audit.requiereRevision !== "boolean" ||
    !Array.isArray(audit.evidencias)
  )
    return null;
  const evidencias: ImageOriginEvidence[] = [];
  for (const item of audit.evidencias.slice(0, 3)) {
    const evidence = record(item);
    if (
      !evidence ||
      typeof evidence.adjuntoId !== "string" ||
      !evidence.adjuntoId ||
      evidence.adjuntoId.length > 100 ||
      typeof evidence.resultado !== "string" ||
      !["COINCIDENCIA_WEB", "SIN_COINCIDENCIAS", "NO_COMPROBADA"].includes(
        evidence.resultado,
      )
    )
      continue;
    const referencias: ImageReference[] = [];
    if (audit.habilitado && Array.isArray(evidence.coincidencias)) {
      for (const item of evidence.coincidencias.slice(0, 5)) {
        const match = record(item);
        if (
          !match ||
          typeof match.tipo !== "string" ||
          !["COMPLETA", "PARCIAL"].includes(match.tipo)
        )
          continue;
        const reference = imageReferenceUrl(match.url);
        if (reference)
          referencias.push({
            ...reference,
            tipo: match.tipo as "COMPLETA" | "PARCIAL",
          });
      }
    }
    if (audit.habilitado && Array.isArray(evidence.paginas)) {
      for (const page of evidence.paginas.slice(0, 5)) {
        const reference = imageReferenceUrl(page);
        if (reference) referencias.push({ ...reference, tipo: "PAGINA" });
      }
    }
    evidencias.push({
      adjuntoId: evidence.adjuntoId,
      resultado: audit.habilitado
        ? (evidence.resultado as ImageOriginEvidence["resultado"])
        : "NO_COMPROBADA",
      motivo:
        typeof evidence.motivo === "string"
          ? evidence.motivo.slice(0, 2000)
          : "No se registró un motivo.",
      referencias,
    });
  }
  return {
    habilitado: audit.habilitado,
    requiereRevision: audit.requiereRevision,
    evidencias,
  };
}
