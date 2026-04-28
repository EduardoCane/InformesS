import { ComponentType } from "react";
import {
  BriefcaseBusiness,
  Building2,
  ClipboardCheck,
  Factory,
  FileText,
  Package,
  ShieldCheck,
  Wrench,
} from "lucide-react";

export interface ContractIconOption {
  id: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}

export const CONTRACT_ICON_OPTIONS: ContractIconOption[] = [
  { id: "shield-check", label: "Seguridad", Icon: ShieldCheck },
  { id: "file-text", label: "Informe", Icon: FileText },
  { id: "clipboard-check", label: "Checklist", Icon: ClipboardCheck },
  { id: "briefcase-business", label: "Negocio", Icon: BriefcaseBusiness },
  { id: "wrench", label: "Herramienta", Icon: Wrench },
  { id: "building-2", label: "Edificio", Icon: Building2 },
  { id: "factory", label: "Planta", Icon: Factory },
  { id: "package", label: "Paquete", Icon: Package },
];

export const DEFAULT_CONTRACT_ICON_ID = CONTRACT_ICON_OPTIONS[0].id;

export const getContractIconOption = (iconId: string | null | undefined) =>
  CONTRACT_ICON_OPTIONS.find((option) => option.id === iconId) ?? CONTRACT_ICON_OPTIONS[0];
