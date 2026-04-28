import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ContractFieldDefinition,
  ContractTemplate,
  DEFAULT_REPEATABLE_GROUP_KEY,
  createContractField,
  createContractFormat,
  getRepeatableGroupLabel,
  ReportFormatDefinition,
} from "@/lib/reportTemplates";
import { cn } from "@/lib/utils";
import { FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type SetTemplates = (
  nextTemplates:
    | ContractTemplate[]
    | ((previousTemplates: ContractTemplate[]) => ContractTemplate[]),
) => void;

export const TemplateTypesEditor = ({
  template,
  setTemplates,
  onDeleteTemplate,
}: {
  template: ContractTemplate | null;
  setTemplates: SetTemplates;
  onDeleteTemplate?: (templateId: string) => Promise<void>;
}) => {
  const [selectedFormatId, setSelectedFormatId] = useState("");

  useEffect(() => {
    if (!template) {
      setSelectedFormatId("");
      return;
    }

    if (!template.formats.some((format) => format.id === selectedFormatId)) {
      setSelectedFormatId(template.defaultFormatId || template.formats[0]?.id || "");
    }
  }, [selectedFormatId, template]);

  const selectedFormat =
    template?.formats.find((format) => format.id === selectedFormatId) ?? null;
  const isSelectedFormatDefault =
    Boolean(template && selectedFormat) && template?.defaultFormatId === selectedFormat?.id;

  const updateSelectedTemplate = (updater: (template: ContractTemplate) => ContractTemplate) => {
    if (!template) return;

    setTemplates((previousTemplates) =>
      previousTemplates.map((currentTemplate) =>
        currentTemplate.id === template.id ? updater(currentTemplate) : currentTemplate,
      ),
    );
  };

  const updateSelectedFormat = (
    formatId: string,
    updater: (format: ReportFormatDefinition) => ReportFormatDefinition,
  ) => {
    updateSelectedTemplate((currentTemplate) => ({
      ...currentTemplate,
      updatedAt: new Date().toISOString(),
      formats: currentTemplate.formats.map((format) =>
        format.id === formatId ? updater(format) : format,
      ),
    }));
  };

  const updateSelectedField = (
    formatId: string,
    fieldId: string,
    updater: (field: ContractFieldDefinition) => ContractFieldDefinition,
  ) => {
    updateSelectedFormat(formatId, (format) => ({
      ...format,
      fields: format.fields.map((field) =>
        field.id === fieldId ? updater(field) : field,
      ),
    }));
  };

  const handleAddField = (formatId: string) => {
    updateSelectedFormat(formatId, (format) => ({
      ...format,
      fields: [...format.fields, createContractField()],
    }));
  };

  const handleRemoveField = (formatId: string, fieldId: string) => {
    updateSelectedFormat(formatId, (format) => ({
      ...format,
      fields: format.fields.filter((field) => field.id !== fieldId),
    }));
  };

  const handleResultFieldChange = (
    formatId: string,
    fieldId: string,
    checked: boolean,
  ) => {
    updateSelectedFormat(formatId, (format) => ({
      ...format,
      fields: format.fields.map((field) => ({
        ...field,
        isResultField: checked ? field.id === fieldId : false,
      })),
    }));
  };

  const handleFieldPlacementChange = (
    formatId: string,
    fieldId: string,
    placement: "single" | "block",
  ) => {
    updateSelectedField(formatId, fieldId, (field) => ({
      ...field,
      repeatableGroup:
        placement === "block"
          ? field.repeatableGroup ?? DEFAULT_REPEATABLE_GROUP_KEY
          : null,
      isResultField: placement === "block" ? false : field.isResultField,
    }));
  };

  const handleFieldBlockNameChange = (
    formatId: string,
    fieldId: string,
    blockName: string,
  ) => {
    updateSelectedField(formatId, fieldId, (field) => ({
      ...field,
      repeatableGroup: blockName.trim() || DEFAULT_REPEATABLE_GROUP_KEY,
      isResultField: false,
    }));
  };

  const handleAddFormat = () => {
    if (!template) return;

    const nextIndex = template.formats.length + 1;
    const nextFormat = createContractFormat({
      name: `Tipo ${nextIndex}`,
      description: "Formato personalizado.",
    });

    updateSelectedTemplate((currentTemplate) => ({
      ...currentTemplate,
      updatedAt: new Date().toISOString(),
      formats: [...currentTemplate.formats, nextFormat],
    }));
    setSelectedFormatId(nextFormat.id);
  };

  const handleRemoveFormat = (formatId: string) => {
    if (!template || template.formats.length <= 1) return;
    if (template.defaultFormatId === formatId) {
      toast.error("No puedes eliminar el tipo predeterminado del contrato seleccionado.");
      return;
    }

    const remainingFormats = template.formats.filter((format) => format.id !== formatId);
    const nextSelectedFormatId =
      remainingFormats.find((format) => format.id === selectedFormatId)?.id ??
      remainingFormats[0]?.id ??
      "";

    updateSelectedTemplate((currentTemplate) => {
      const nextFormats = currentTemplate.formats.filter((format) => format.id !== formatId);
      const nextDefaultFormatId =
        currentTemplate.defaultFormatId === formatId
          ? nextFormats[0]?.id ?? ""
          : currentTemplate.defaultFormatId;

      return {
        ...currentTemplate,
        updatedAt: new Date().toISOString(),
        defaultFormatId: nextDefaultFormatId,
        formats: nextFormats,
      };
    });

    setSelectedFormatId(nextSelectedFormatId);
  };

  if (!template) {
    return (
      <Card className="shadow-soft-sm">
        <CardContent className="flex min-h-[420px] flex-col items-center justify-center px-6 py-12 text-center">
          <FileText className="mb-4 h-10 w-10 text-muted-foreground" />
          <h2 className="text-base font-semibold">Selecciona un tipo</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Elige un tipo en la columna izquierda para editar sus campos.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="shadow-soft-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <CardTitle className="text-sm font-medium">Tipos de contrato</CardTitle>
            <Button size="sm" variant="outline" onClick={handleAddFormat} className="w-full sm:w-auto">
              <Plus className="mr-1.5 h-4 w-4" />
              Agregar tipo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {template.formats.map((format, index) => (
              <button
                key={format.id}
                type="button"
                onClick={() => setSelectedFormatId(format.id)}
                className={cn(
                  "w-full rounded-lg border p-4 text-left transition-colors",
                  format.id === selectedFormatId
                    ? "border-primary bg-primary-muted"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {index + 1}. {format.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {format.description || "Sin descripcion"}
                    </p>
                  </div>
                  <Badge variant="secondary">{format.fields.length}</Badge>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedFormat ? (
        <Card className="shadow-soft-md">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Editor del tipo</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tipo seleccionado: {selectedFormat.name}.
                </p>
              </div>
              {template.formats.length > 1 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full text-destructive hover:text-destructive sm:w-auto"
                  disabled={isSelectedFormatDefault}
                  onClick={() => handleRemoveFormat(selectedFormat.id)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Eliminar tipo
                </Button>
              ) : null}
            </div>
            {isSelectedFormatDefault ? (
              <p className="text-xs text-muted-foreground">
                No se puede eliminar este tipo porque esta configurado en el contrato seleccionado.
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <EditorField label="Nombre del formato">
                <Input
                  value={selectedFormat.name}
                  onChange={(event) =>
                    updateSelectedFormat(selectedFormat.id, (currentFormat) => ({
                      ...currentFormat,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Ej. Formato de campo"
                />
              </EditorField>

              <EditorField label="Descripcion del formato">
                <Input
                  value={selectedFormat.description}
                  onChange={(event) =>
                    updateSelectedFormat(selectedFormat.id, (currentFormat) => ({
                      ...currentFormat,
                      description: event.target.value,
                    }))
                  }
                  placeholder="Que informacion pide este formato"
                />
              </EditorField>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold">Campos del formato</h3>
                <p className="text-xs text-muted-foreground">
                  Esto es lo que se pedira en el paso Campos de Nueva inspeccion,
                  incluyendo si cada campo sera individual o de bloque.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAddField(selectedFormat.id)}
                className="w-full sm:w-auto"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Agregar campo
              </Button>
            </div>

            {selectedFormat.fields.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Este formato no tiene campos</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Agrega los campos que quieras pedir cuando se use este tipo.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {selectedFormat.fields
                  .filter((field) => !field.isResultField && !field.id.endsWith("-status-other"))
                  .map((field) => (
                  <div key={field.id} className="rounded-lg border border-border p-4">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_220px_220px_auto]">
                      <EditorField label="Etiqueta del campo">
                        <Input
                          value={field.label}
                          onChange={(event) =>
                            updateSelectedField(selectedFormat.id, field.id, (currentField) => ({
                              ...currentField,
                              label: event.target.value,
                            }))
                          }
                          placeholder="Nombre visible del campo"
                        />
                      </EditorField>

                      <EditorField label="Tipo">
                        <Select
                          value={field.type}
                          onValueChange={(value) =>
                            updateSelectedField(selectedFormat.id, field.id, (currentField) => ({
                              ...currentField,
                              type: value as ContractFieldDefinition["type"],
                              options:
                                value === "select" || value === "radio"
                                  ? currentField.options
                                  : [],
                              isResultField:
                                value === "image" || currentField.repeatableGroup
                                  ? false
                                  : currentField.isResultField,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="text">Texto corto</SelectItem>
                            <SelectItem value="textarea">Texto largo</SelectItem>
                            <SelectItem value="select">Lista</SelectItem>
                            <SelectItem value="radio">Opcion unica</SelectItem>
                            <SelectItem value="image">Imagen</SelectItem>
                          </SelectContent>
                        </Select>
                      </EditorField>

                      <EditorField label="Ubicacion">
                        <Select
                          value={field.repeatableGroup ? "block" : "single"}
                          onValueChange={(value) =>
                            handleFieldPlacementChange(
                              selectedFormat.id,
                              field.id,
                              value as "single" | "block",
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="single">Campo individual</SelectItem>
                            <SelectItem value="block">Campo de bloque</SelectItem>
                          </SelectContent>
                        </Select>
                      </EditorField>

                      <div className="flex items-end justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleRemoveField(selectedFormat.id, field.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {(field.type === "select" || field.type === "radio") && (
                      <div className="mt-4">
                        <EditorField label="Opciones separadas por coma">
                          <Input
                            value={field.options.join(", ")}
                            onChange={(event) =>
                              updateSelectedField(selectedFormat.id, field.id, (currentField) => ({
                                ...currentField,
                                options: event.target.value
                                  .split(",")
                                  .map((option) => option.trim())
                                  .filter(Boolean),
                              }))
                            }
                            placeholder="Ej. Bueno, Regular, Malo"
                          />
                        </EditorField>
                      </div>
                    )}

                    {field.repeatableGroup && (
                      <div className="mt-4 space-y-3 rounded-md border border-border/70 bg-muted/10 p-3">
                        <EditorField label="Nombre del bloque">
                          <Input
                            value={
                              field.repeatableGroup === DEFAULT_REPEATABLE_GROUP_KEY
                                ? ""
                                : field.repeatableGroup
                            }
                            onChange={(event) =>
                              handleFieldBlockNameChange(
                                selectedFormat.id,
                                field.id,
                                event.target.value,
                              )
                            }
                            placeholder="Ej. Hallazgos"
                          />
                        </EditorField>
                        <p className="text-xs text-muted-foreground">
                          Los campos con el mismo nombre de bloque se agrupan juntos.
                          Dejalo vacio para usar {getRepeatableGroupLabel(DEFAULT_REPEATABLE_GROUP_KEY)}.
                        </p>
                      </div>
                    )}

                    <div className="mt-4 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      {field.repeatableGroup
                        ? `Este campo aparecera dentro de ${getRepeatableGroupLabel(field.repeatableGroup)} y se repetira al agregar nuevos bloques.`
                        : "Este campo aparecera una sola vez en el formulario de la inspeccion."}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-6">
                      <div className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={field.required}
                          onCheckedChange={(checked) =>
                            updateSelectedField(selectedFormat.id, field.id, (currentField) => ({
                              ...currentField,
                              required: Boolean(checked),
                            }))
                          }
                        />
                        <span>Campo requerido</span>
                      </div>

                      <div className="flex items-center gap-2 text-sm">
                        <Switch
                          disabled={field.type === "image" || Boolean(field.repeatableGroup)}
                          checked={field.isResultField}
                          onCheckedChange={(checked) =>
                            handleResultFieldChange(
                              selectedFormat.id,
                              field.id,
                              Boolean(checked),
                            )
                          }
                        />
                        <span>
                          {field.type === "image"
                            ? "La imagen no puede ser resultado"
                            : field.repeatableGroup
                              ? "Un campo de bloque no puede ser resultado"
                              : "Usar como resultado del informe"}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-soft-sm">
          <CardContent className="flex min-h-[420px] flex-col items-center justify-center px-6 py-12 text-center">
            <FileText className="mb-4 h-10 w-10 text-muted-foreground" />
            <h2 className="text-base font-semibold">Selecciona un tipo</h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Elige un tipo en la columna izquierda para editar sus campos.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const EditorField = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <Label className="text-xs">{label}</Label>
    {children}
  </div>
);
