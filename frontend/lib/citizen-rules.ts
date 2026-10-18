export interface CitizenRules {
  agrupacionMetros: number;
  agrupacionHoras: number;
  confirmacionMetros: number;
  confirmaciones: number;
}

export function citizenRules(config: Record<string, unknown>): CitizenRules {
  const value = (key: string, fallback: number, min: number, max: number) => {
    const candidate = config[key];
    return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= min && candidate <= max ? candidate : fallback;
  };
  return {
    agrupacionMetros: value('agrupacionMetros', 50, 10, 200),
    agrupacionHoras: value('agrupacionHoras', 3, 1, 24),
    confirmacionMetros: value('confirmacionMetros', 50, 10, 200),
    confirmaciones: value('confirmaciones', 3, 1, 20),
  };
}

export function groupingExplanation(rules: CitizenRules) {
  return `Los reportes del mismo tipo a menos de ${rules.agrupacionMetros} metros, dentro de ${rules.agrupacionHoras} ${rules.agrupacionHoras === 1 ? 'hora' : 'horas'}, pueden agruparse en un incidente común.`;
}

export function confirmationExplanation(rules: CitizenRules | null) {
  return rules
    ? `Confirmar o marcar como resuelto requiere estar a ${rules.confirmacionMetros} metros o menos. Una persona puede confirmar una sola vez.`
    : 'Confirmar o marcar como resuelto requiere estar cerca del incidente. CiviGo comprueba la distancia permitida al enviar tu ubicación. Una persona puede confirmar una sola vez.';
}
