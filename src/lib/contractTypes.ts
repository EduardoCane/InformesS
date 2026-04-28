export type ContractType = "servicios" | "obra" | "mantenimiento" | "otro";

export const CONTRACT_TYPES: { value: ContractType; label: string; description: string }[] = [
  { value: "servicios", label: "Contrato de servicios", description: "Servicios profesionales o consultoría" },
  { value: "obra", label: "Contrato de obra", description: "Construcción, instalación o montaje" },
  { value: "mantenimiento", label: "Contrato de mantenimiento", description: "Mantenimiento preventivo o correctivo" },
  { value: "otro", label: "Otro", description: "Otro tipo de contrato" },
];

export const contractLabel = (value: string): string =>
  CONTRACT_TYPES.find((c) => c.value === value)?.label ?? value;

export interface DynamicField {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "radio";
  options?: string[];
  required?: boolean;
}

export const DYNAMIC_FIELDS_BY_CONTRACT: Record<ContractType, DynamicField[]> = {
  servicios: [
    { key: "service_scope", label: "Alcance del servicio", type: "text" },
    { key: "service_quality", label: "Calidad observada", type: "select", options: ["Excelente", "Aceptable", "Deficiente"] },
    { key: "risk_level", label: "Nivel de riesgo", type: "select", options: ["Bajo", "Medio", "Alto", "Crítico"] },
    { key: "observations", label: "Observaciones", type: "textarea" },
    { key: "compliance", label: "Cumplimiento", type: "radio", options: ["Cumple", "No cumple"] },
  ],
  obra: [
    { key: "construction_phase", label: "Fase de obra", type: "select", options: ["Cimentación", "Estructura", "Acabados", "Entrega"] },
    { key: "safety_equipment", label: "Equipo de seguridad presente", type: "select", options: ["Completo", "Parcial", "Ausente"] },
    { key: "risk_level", label: "Nivel de riesgo", type: "select", options: ["Bajo", "Medio", "Alto", "Crítico"] },
    { key: "observations", label: "Observaciones", type: "textarea" },
    { key: "compliance", label: "Cumplimiento", type: "radio", options: ["Cumple", "No cumple"] },
  ],
  mantenimiento: [
    { key: "maintenance_type", label: "Tipo de mantenimiento", type: "select", options: ["Preventivo", "Correctivo", "Predictivo"] },
    { key: "equipment", label: "Equipo intervenido", type: "text" },
    { key: "risk_level", label: "Nivel de riesgo", type: "select", options: ["Bajo", "Medio", "Alto", "Crítico"] },
    { key: "observations", label: "Observaciones", type: "textarea" },
    { key: "compliance", label: "Cumplimiento", type: "radio", options: ["Cumple", "No cumple"] },
  ],
  otro: [
    { key: "field_1", label: "Campo específico 1", type: "text" },
    { key: "field_2", label: "Campo específico 2", type: "text" },
    { key: "risk_level", label: "Nivel de riesgo", type: "select", options: ["Bajo", "Medio", "Alto", "Crítico"] },
    { key: "observations", label: "Observaciones", type: "textarea" },
    { key: "compliance", label: "Cumplimiento", type: "radio", options: ["Cumple", "No cumple"] },
  ],
};
