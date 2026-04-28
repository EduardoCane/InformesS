import { supabase } from "@/integrations/supabase/client";
import { ContractTemplate, ReportFormatDefinition } from "./reportTemplates";

// =====================================================
// PLANTILLAS DE CONTRATOS
// =====================================================

const CONTRACT_TEMPLATE_SELECT = `
  id,
  user_id,
  name,
  description,
  icon_name,
  default_format_id,
  created_at,
  updated_at
`;

const BASE_REPORT_FORMAT_SELECT = `
  id,
  name,
  description,
  schema_json,
  created_at,
  updated_at
`;

const fetchGlobalReportFormats = async () => {
  const { data, error } = await supabase
    .from("report_formats")
    .select(BASE_REPORT_FORMAT_SELECT)
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
};

const attachFormatsToTemplates = (
  templates: Array<Record<string, unknown>>,
  reportFormats: Array<Record<string, unknown>>,
) =>
  templates.map((template) => ({
    ...template,
    report_formats: reportFormats,
  }));

const withTimeout = async <T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = 30000,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `${label} agotó el tiempo de espera (${timeoutMs / 1000}s). Supabase no respondió a tiempo.`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export const fetchContractTemplates = async (_userId: string) => {
  const [{ data, error }, reportFormats] = await Promise.all([
    supabase
      .from("contract_templates")
      .select(CONTRACT_TEMPLATE_SELECT)
      .order("created_at", { ascending: false }),
    fetchGlobalReportFormats(),
  ]);

  if (error) throw error;

  const templates = data || [];
  return attachFormatsToTemplates(templates, reportFormats);
};

export const fetchContractTemplatesForEditor = async (userId: string) => {
  const [{ data, error }, reportFormats] = await Promise.all([
    supabase
      .from("contract_templates")
      .select(CONTRACT_TEMPLATE_SELECT)
      .order("created_at", { ascending: false }),
    fetchGlobalReportFormats(),
  ]);

  if (error) throw error;

  const templates = data || [];

  // Si no hay templates, crear uno inicial automáticamente
  if (templates.length === 0 && reportFormats.length > 0) {
    try {
      const defaultFormatId =
        (reportFormats.find((f: any) => f.name?.toLowerCase() === "normal")?.id as string) ||
        (reportFormats[0]?.id as string);

      const { data: newTemplate, error: createError } = await supabase
        .from("contract_templates")
        .insert({
          user_id: userId,
          name: "Contrato",
          description: "Contrato para editar tipos",
          icon_name: "shield",
          default_format_id: defaultFormatId,
        })
        .select(CONTRACT_TEMPLATE_SELECT)
        .single();

      if (createError) {
        console.warn("No se pudo crear contrato inicial:", createError);
        return attachFormatsToTemplates(templates, reportFormats);
      }

      return attachFormatsToTemplates([newTemplate], reportFormats);
    } catch (err) {
      console.warn("Error creando contrato inicial:", err);
      return attachFormatsToTemplates(templates, reportFormats);
    }
  }

  return attachFormatsToTemplates(templates, reportFormats);
};

export const fetchContractTemplateById = async (templateId: string, _userId?: string) => {
  const query = supabase
    .from("contract_templates")
    .select(CONTRACT_TEMPLATE_SELECT)
    .eq("id", templateId);

  const [{ data, error }, reportFormats] = await Promise.all([
    query.single(),
    fetchGlobalReportFormats(),
  ]);

  if (error) throw error;
  return {
    ...data,
    report_formats: reportFormats,
  };
};

export const fetchBaseReportFormats = async () => {
  return fetchGlobalReportFormats();
};

export const fetchGlobalTypesAsTemplate = async () => {
  const reportFormats = await fetchGlobalReportFormats();
  
  // Retorna un "template virtual" que representa los tipos globales
  return {
    id: "global-types",
    user_id: null,
    name: "Tipos de contrato globales",
    description: "Tipos y campos disponibles para todos los contratos",
    icon_name: "globe",
    default_format_id: reportFormats[0]?.id || "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    report_formats: reportFormats,
  };
};

export const createContractTemplate = async (
  userId: string,
  template: Omit<ContractTemplate, "id" | "createdAt" | "updatedAt">
) => {
  const requestedDefaultFormat =
    template.formats.find((format) => format.id === template.defaultFormatId) ??
    template.formats[0] ??
    null;
  const reportFormats = await fetchGlobalReportFormats();
  const persistedDefaultFormatId =
    reportFormats.find(
      (format) =>
        format.id === requestedDefaultFormat?.id ||
        format.name === requestedDefaultFormat?.name,
    )?.id ??
    reportFormats[0]?.id ??
    null;

  const { data, error } = await withTimeout(
    supabase
      .from("contract_templates")
      .insert({
        user_id: userId,
        name: template.name,
        description: template.description,
        icon_name: template.iconName,
        default_format_id: persistedDefaultFormatId,
      })
      .select(CONTRACT_TEMPLATE_SELECT)
      .single(),
    "Crear plantilla",
  );

  if (error) throw error;

  return {
    ...data,
    report_formats: reportFormats,
  };
};

export const updateContractTemplate = async (
  templateId: string,
  updates: Partial<ContractTemplate>
) => {
  const { data, error } = await supabase
    .from("contract_templates")
    .update({
      name: updates.name,
      description: updates.description,
      icon_name: updates.iconName,
      default_format_id: updates.defaultFormatId,
    })
    .eq("id", templateId)
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const deleteContractTemplate = async (templateId: string) => {
  const { count, error: countError } = await supabase
    .from("inspections")
    .select("id", { count: "exact", head: true })
    .eq("template_id", templateId);

  if (countError) throw countError;

  if ((count || 0) > 0) {
    const inspectionLabel = count === 1 ? "inspeccion asociada" : "inspecciones asociadas";
    throw new Error(
      `No se puede eliminar este contrato porque tiene ${count} ${inspectionLabel}.`,
    );
  }

  const { error } = await supabase
    .from("contract_templates")
    .delete()
    .eq("id", templateId);

  if (error) throw error;
};

// =====================================================
// FORMATOS DE REPORTE
// =====================================================

export const createReportFormat = async (
  _templateId: string,
  format: ReportFormatDefinition
) => {
  const { data, error } = await withTimeout(
    supabase
      .from("report_formats")
      .insert({
        name: format.name,
        description: format.description,
        schema_json: format.fields,
      })
      .select()
      .single(),
    `Crear formato ${format.name}`,
  );

  if (error) throw error;

  return {
    ...data,
    schema_json: format.fields,
  };
};

export const updateReportFormat = async (
  formatId: string,
  format: ReportFormatDefinition
) => {
  const { error: updateError } = await supabase
    .from("report_formats")
    .update({
      name: format.name,
      description: format.description,
      schema_json: format.fields,
    })
    .eq("id", formatId);

  if (updateError) throw updateError;
};

export const deleteReportFormat = async (formatId: string) => {
  const { count, error: countError } = await supabase
    .from("contract_templates")
    .select("id", { count: "exact", head: true })
    .eq("default_format_id", formatId);

  if (countError) throw countError;

  if ((count || 0) > 0) {
    const contractLabel = count === 1 ? "contrato" : "contratos";
    throw new Error(
      `No se puede eliminar este tipo porque hay ${count} ${contractLabel} con ese tipo seleccionado.`,
    );
  }

  const { error } = await supabase
    .from("report_formats")
    .delete()
    .eq("id", formatId);

  if (error) throw error;
};

// =====================================================
// INSPECCIONES
// =====================================================

export const createInspection = async (
  inspection: Record<string, unknown>
) => {
  const { data, error } = await supabase
    .from("inspections")
    .insert(inspection)
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const fetchUserInspections = async (userId: string) => {
  const { data, error } = await supabase
    .from("inspections")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
};

export const fetchInspectionById = async (inspectionId: string) => {
  const { data, error } = await supabase
    .from("inspections")
    .select("*")
    .eq("id", inspectionId)
    .single();

  if (error) throw error;
  return data;
};

export const checkTemplateUsageInInspections = async (templateId: string) => {
  const { count, error } = await supabase
    .from("inspections")
    .select("id", { count: "exact", head: true })
    .eq("template_id", templateId);

  if (error) throw error;
  return count || 0;
};

export const updateInspection = async (
  inspectionId: string,
  updates: Record<string, unknown>
) => {
  const { data, error } = await supabase
    .from("inspections")
    .update(updates)
    .eq("id", inspectionId)
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const deleteInspection = async (inspectionId: string) => {
  const { error } = await supabase
    .from("inspections")
    .delete()
    .eq("id", inspectionId);

  if (error) throw error;
};

export const archiveInspection = async (inspectionId: string) => {
  const { error } = await supabase
    .from("inspections")
    .update({
      status: "archived",
      archived_at: new Date().toISOString(),
    })
    .eq("id", inspectionId);

  if (error) throw error;
};
