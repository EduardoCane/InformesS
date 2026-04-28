import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./useAuth";
import {
  fetchContractTemplates,
  fetchContractTemplatesForEditor,
  createContractTemplate as createTemplateInDb,
  updateContractTemplate as updateTemplateInDb,
  deleteContractTemplate as deleteTemplateInDb,
  createReportFormat as createFormatInDb,
  updateReportFormat as updateFormatInDb,
  deleteReportFormat as deleteFormatInDb,
} from "@/lib/supabase";
import {
  ContractTemplate,
  ReportFormatDefinition,
} from "@/lib/reportTemplates";

export const useContractTemplates = (useForEditor = false) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [templates, setTemplatesState] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mapDbTemplate = useCallback((dbTemplate: any): ContractTemplate => {
    const formats = [...(dbTemplate.report_formats || [])]
      .sort(
        (a: any, b: any) =>
          new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime(),
      )
      .map((dbFormat: any) => ({
        id: dbFormat.id,
        name: dbFormat.name,
        description: dbFormat.description,
        fields: Array.isArray(dbFormat.schema_json)
          ? dbFormat.schema_json.map((field: any) => ({
              id: field.id,
              label: field.label,
              type: field.type,
              options: field.options || [],
              required: field.required,
              isResultField: field.isResultField,
              repeatableGroup: field.repeatableGroup,
            }))
          : [],
      }));

    return {
      id: dbTemplate.id,
      name: dbTemplate.name,
      description: dbTemplate.description,
      iconName: dbTemplate.icon_name,
      defaultFormatId: dbTemplate.default_format_id || formats[0]?.id || "",
      createdAt: dbTemplate.created_at,
      updatedAt: dbTemplate.updated_at,
      formats,
    };
  }, []);

  // Cargar plantillas de Supabase
  useEffect(() => {
    const loadTemplates = async () => {
      if (!userId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        const fetchFn = useForEditor ? fetchContractTemplatesForEditor : fetchContractTemplates;
        const data = await fetchFn(userId);

        const transformed = data.map(mapDbTemplate);

        setTemplatesState(transformed);
      } catch (err) {
        console.error("Error loading templates:", err);
        setError(err instanceof Error ? err.message : "Error al cargar plantillas");
        setTemplatesState([]);
      } finally {
        setLoading(false);
      }
    };

    loadTemplates();
  }, [mapDbTemplate, userId, useForEditor]);

  const setTemplates = useCallback(
    async (
      nextTemplates:
        | ContractTemplate[]
        | ((previousTemplates: ContractTemplate[]) => ContractTemplate[]),
    ) => {
      try {
        const resolvedTemplates =
          typeof nextTemplates === "function"
            ? nextTemplates(templates)
            : nextTemplates;

        setTemplatesState(resolvedTemplates);
        // No guardar en localStorage, confiar en Supabase que ya está guardado
      } catch (err) {
        console.error("Error updating templates:", err);
        setError(err instanceof Error ? err.message : "Error al actualizar plantillas");
      }
    },
    [templates],
  );

  const createTemplate = useCallback(
    async (template: Omit<ContractTemplate, "id" | "createdAt" | "updatedAt">) => {
      if (!userId) throw new Error("Usuario no autenticado");

      try {
        const dbTemplate = await createTemplateInDb(userId, template);
        const newTemplate = mapDbTemplate(dbTemplate);

        setTemplatesState((prev) => [newTemplate, ...prev]);
        return newTemplate;
      } catch (err) {
        console.error("Error creating template:", err);
        throw err;
      }
    },
    [mapDbTemplate, userId],
  );

  const updateTemplate = useCallback(
    async (templateId: string, updates: Partial<ContractTemplate>) => {
      if (!userId) throw new Error("Usuario no autenticado");

      try {
        await updateTemplateInDb(templateId, updates);

        setTemplatesState((prev) =>
          prev.map((t) => (t.id === templateId ? { ...t, ...updates } : t)),
        );
      } catch (err) {
        console.error("Error updating template:", err);
        throw err;
      }
    },
    [userId],
  );

  const deleteTemplate = useCallback(
    async (templateId: string) => {
      if (!userId) throw new Error("Usuario no autenticado");

      try {
        await deleteTemplateInDb(templateId);
        setTemplatesState((prev) => prev.filter((t) => t.id !== templateId));
      } catch (err) {
        console.error("Error deleting template:", err);
        throw err;
      }
    },
    [userId],
  );

  const createFormat = useCallback(
    async (templateId: string, format: ReportFormatDefinition) => {
      if (!userId) throw new Error("Usuario no autenticado");

      try {
        const dbFormat = await createFormatInDb(templateId, format);
        const persistedFormat: ReportFormatDefinition = {
          ...format,
          id: dbFormat.id,
        };

        setTemplatesState((prev) =>
          prev.map((t) => {
            const hasFormat = t.formats.some((f) => f.id === persistedFormat.id);
            const nextFormats = hasFormat
              ? t.formats.map((f) => (f.id === persistedFormat.id ? persistedFormat : f))
              : [...t.formats, persistedFormat];

            return {
              ...t,
              defaultFormatId: t.defaultFormatId || persistedFormat.id,
              formats: nextFormats,
            };
          }),
        );

        return dbFormat;
      } catch (err) {
        console.error("Error creating format:", err);
        throw err;
      }
    },
    [userId],
  );

  const updateFormat = useCallback(
    async (templateId: string, formatId: string, format: ReportFormatDefinition) => {
      if (!userId) throw new Error("Usuario no autenticado");

      try {
        await updateFormatInDb(formatId, format);
        const normalizedFormat = {
          ...format,
          id: formatId,
        };

        setTemplatesState((prev) =>
          prev.map((t) =>
            t.id === templateId || t.formats.some((f) => f.id === formatId)
              ? {
                  ...t,
                  formats: t.formats.map((f) =>
                    f.id === formatId ? normalizedFormat : f,
                  ),
                }
              : t,
          ),
        );
      } catch (err) {
        console.error("Error updating format:", err);
        throw err;
      }
    },
    [userId],
  );

  const deleteFormat = useCallback(
    async (templateId: string, formatId: string) => {
      if (!userId) throw new Error("Usuario no autenticado");

      try {
        await deleteFormatInDb(formatId);

        setTemplatesState((prev) =>
          prev.map((t) => {
            if (t.id !== templateId && !t.formats.some((f) => f.id === formatId)) {
              return t;
            }

            const nextFormats = t.formats.filter((f) => f.id !== formatId);
            return {
              ...t,
              defaultFormatId:
                t.defaultFormatId === formatId
                  ? (nextFormats[0]?.id ?? "")
                  : t.defaultFormatId,
              formats: nextFormats,
            };
          }),
        );
      } catch (err) {
        console.error("Error deleting format:", err);
        throw err;
      }
    },
    [userId],
  );

  const reload = useCallback(async () => {
    if (userId) {
      const data = await fetchContractTemplates(userId);
      const transformed = data.map(mapDbTemplate);
      setTemplatesState(transformed);
    }
  }, [mapDbTemplate, userId]);

  return {
    templates,
    loading,
    error,
    setTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    createFormat,
    updateFormat,
    deleteFormat,
    reload,
  };
};
