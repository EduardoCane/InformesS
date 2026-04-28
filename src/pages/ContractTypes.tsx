import { useEffect, useMemo, useState } from "react";
import { TemplateTypesEditor } from "@/components/contracts/TemplateTypesEditor";
import { Header } from "@/components/layout/Header";
import {
  ContractTemplate,
} from "@/lib/reportTemplates";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchGlobalTypesAsTemplate, updateReportFormat, createReportFormat, deleteReportFormat } from "@/lib/supabase";

type SetTemplates =
  | ContractTemplate[]
  | ((previousTemplates: ContractTemplate[]) => ContractTemplate[]);

const cloneTemplate = (template: ContractTemplate): ContractTemplate => ({
  ...template,
  formats: template.formats.map((format) => ({
    ...format,
    fields: format.fields.map((field) => ({
      ...field,
      options: [...field.options],
    })),
  })),
});

const getErrorMessage = (error: unknown) => {
  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return "Error al guardar los tipos de contrato";
};

const mapDbFormat = (dbFormat: any) => ({
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
});

const ContractTypes = () => {
  const [template, setTemplate] = useState<ContractTemplate | null>(null);
  const [editorTemplate, setEditorTemplate] = useState<ContractTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadTypes = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const data = await fetchGlobalTypesAsTemplate();
        
        // Mapear formatos
        const mappedTemplate: ContractTemplate = {
          id: data.id,
          name: data.name,
          description: data.description,
          iconName: data.icon_name,
          defaultFormatId: data.default_format_id,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
          formats: (data.report_formats || []).map(mapDbFormat),
        };
        
        setTemplate(mappedTemplate);
        setEditorTemplate(cloneTemplate(mappedTemplate));
      } catch (err) {
        console.error("Error loading types:", err);
        setError(err instanceof Error ? err.message : "Error al cargar tipos");
      } finally {
        setLoading(false);
      }
    };

    loadTypes();
  }, []);

  const handleDraftTemplatesChange = (nextTemplates: SetTemplates) => {
    if (!template) return;

    setEditorTemplate((previousEditorTemplate) => {
      const baseTemplate = previousEditorTemplate ?? cloneTemplate(template);
      const resolvedTemplates =
        typeof nextTemplates === "function"
          ? nextTemplates([baseTemplate])
          : nextTemplates;

      return resolvedTemplates[0] ?? baseTemplate;
    });
  };

  const hasPendingChanges = useMemo(() => {
    if (!template || !editorTemplate) return false;
    return JSON.stringify(editorTemplate) !== JSON.stringify(template);
  }, [editorTemplate, template]);

  const handleSave = async () => {
    if (!template || !editorTemplate || !hasPendingChanges) return;

    try {
      setIsSaving(true);
      const originalFormats = template.formats;
      const updatedFormats = editorTemplate.formats;

      for (const format of updatedFormats) {
        const originalFormat = originalFormats.find((f) => f.id === format.id);

        if (!originalFormat) {
          await createReportFormat("", format);
          continue;
        }

        if (JSON.stringify(originalFormat) !== JSON.stringify(format)) {
          await updateReportFormat(format.id, format);
        }
      }

      for (const format of originalFormats) {
        if (!updatedFormats.some((f) => f.id === format.id)) {
          await deleteReportFormat(format.id);
        }
      }

      // Recargar
      const data = await fetchGlobalTypesAsTemplate();
      const mappedTemplate: ContractTemplate = {
        id: data.id,
        name: data.name,
        description: data.description,
        iconName: data.icon_name,
        defaultFormatId: data.default_format_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        formats: (data.report_formats || []).map(mapDbFormat),
      };
      
      setTemplate(mappedTemplate);
      setEditorTemplate(cloneTemplate(mappedTemplate));
      toast.success("Cambios guardados");
    } catch (error) {
      console.error("Error saving types:", error);
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Header
        title="Tipos de contrato"
        subtitle="Edita los tipos y campos disponibles para todos los contratos."
        showSearch={false}
        showSettings={false}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            disabled={loading || isSaving || !hasPendingChanges}
            className="h-10 rounded-full border-border/70 bg-background/90 px-4 shadow-soft-sm hover:bg-background"
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Guardar
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-6 animate-fade-in sm:px-6 sm:py-8">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Cargando tipos...</span>
            </div>
          ) : error ? (
            <div className="text-center">
              <p className="text-destructive">Error al cargar tipos: {error}</p>
            </div>
          ) : editorTemplate ? (
            <TemplateTypesEditor
              template={editorTemplate}
              setTemplates={handleDraftTemplatesChange}
            />
          ) : (
            <div className="text-center">
              <p className="text-muted-foreground">No hay tipos disponibles</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ContractTypes;
