import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Header } from "@/components/layout/Header";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { useContractTemplates } from "@/hooks/useContractTemplates";
import { supabase } from "@/integrations/supabase/client";
import {
  CONTRACT_ICON_OPTIONS,
  getContractIconOption,
} from "@/lib/contractIcons";
import {
  ContractTemplate,
  extractInspectionEvidenceEntries,
  getRepeatableLayout,
  getRepeatableGroupLabel,
  ReportFormatDefinition,
  buildInspectionDynamicFields,
  createContractTemplateFromFormats,
} from "@/lib/reportTemplates";
import { checkTemplateUsageInInspections, fetchBaseReportFormats } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FolderKanban,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

type DynamicFieldValue = string | string[] | (string | string[])[];

const getLocalDateInputValue = () => {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60_000;

  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
};

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });

const normalizeDynamicFieldArray = (value: DynamicFieldValue | undefined): (string | string[])[] => {
  if (Array.isArray(value)) {
    // Si es un array, retornarlo como está (puede contener strings o arrays de strings)
    return value;
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
};

const getRepeatableBlockValue = (blockIndex: number) => `block-${blockIndex}`;

const getRepeatableBlockIndex = (value: string) => {
  if (!value.startsWith("block-")) return null;

  const blockIndex = Number(value.slice("block-".length));
  return Number.isInteger(blockIndex) ? blockIndex : null;
};

const countFilledDynamicValues = (values: Record<string, DynamicFieldValue>) =>
  Object.values(values).reduce((filledCount, value) => {
    if (Array.isArray(value)) {
      return (
        filledCount +
        value.filter((entry) => typeof entry === "string" && entry.trim()).length
      );
    }

    return typeof value === "string" && value.trim() ? filledCount + 1 : filledCount;
  }, 0);

const getErrorMessage = (error: unknown) => {
  if (error && typeof error === "object" && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return "Error desconocido";
};

const getTemplateConfiguredType = (template: ContractTemplate) => {
  return (
    template.formats.find((format) => format.id === template.defaultFormatId)?.name ??
    template.formats[0]?.name ??
    "Sin tipo"
  );
};

const getTemplateDefaultFormatIdByType = (
  template: ContractTemplate,
  type: string,
) => {
  return (
    template.formats.find((format) => format.name === type)?.id ??
    template.defaultFormatId ??
    template.formats[0]?.id ??
    ""
  );
};

const getTemplateTypeOptions = (template: ContractTemplate | null) => {
  if (!template) return [];

  return template.formats
    .map((format) => format.name.trim())
    .filter((formatName, index, formatNames) => formatName && formatNames.indexOf(formatName) === index);
};

const getFormatTypeOptions = (formats: ReportFormatDefinition[]) =>
  formats
    .map((format) => format.name.trim())
    .filter((formatName, index, formatNames) => formatName && formatNames.indexOf(formatName) === index);

const getTemplateUsageMessage = (count: number) =>
  `No se puede eliminar este contrato porque tiene ${count} inspeccion${count === 1 ? "" : "es"} asociada${count === 1 ? "" : "s"}.`;

const STEPS = [
  { id: 1, label: "Contrato", icon: FolderKanban },
  { id: 2, label: "Datos", icon: MapPin },
  { id: 3, label: "Campos", icon: ListChecks },
  { id: 4, label: "Guardar", icon: Save },
];

const NewInspection = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    templates,
    loading: templatesLoading,
    error: templatesError,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    reload: reloadTemplates,
  } = useContractTemplates();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [refreshingContracts, setRefreshingContracts] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedFormatId, setSelectedFormatId] = useState("");
  const [isEditMode, setIsEditMode] = useState(false);
  const [isCreateContractOpen, setIsCreateContractOpen] = useState(false);
  const [isEditContractOpen, setIsEditContractOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState("");
  const [editingContractName, setEditingContractName] = useState("");
  const [editingContractSelectedType, setEditingContractSelectedType] = useState("");
  const [newContractName, setNewContractName] = useState("");
  const [newContractSelectedType, setNewContractSelectedType] = useState("");
  const [newContractIconName, setNewContractIconName] = useState(
    CONTRACT_ICON_OPTIONS[0].id,
  );
  const [contractTypePresets, setContractTypePresets] = useState<ReportFormatDefinition[]>([]);
  const [contractTypePresetsLoading, setContractTypePresetsLoading] = useState(true);
  const [contractTypePresetsError, setContractTypePresetsError] = useState("");
  const [creatingContract, setCreatingContract] = useState(false);
  const [createContractError, setCreateContractError] = useState("");
  const [contractToDelete, setContractToDelete] = useState<ContractTemplate | null>(null);

  const [generalData, setGeneralData] = useState({
    title: "",
    recipient_name: "",
    recipient_title: "",
    sender_name: "",
    sender_title: "",
    subject: "",
    inspection_date: getLocalDateInputValue(),
  });
  const [dynamicFields, setDynamicFields] = useState<Record<string, DynamicFieldValue>>({});

  useEffect(() => {
    if (!templates.length) {
      setSelectedTemplateId("");
      setSelectedFormatId("");
      return;
    }

    if (!selectedTemplateId || !templates.some((template) => template.id === selectedTemplateId)) {
      const firstTemplate = templates[0];
      setSelectedTemplateId(firstTemplate.id);
      setSelectedFormatId(firstTemplate.defaultFormatId || firstTemplate.formats[0]?.id || "");
    }
  }, [templates, selectedTemplateId]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );
  const editingTemplate = useMemo(
    () => templates.find((template) => template.id === editingTemplateId) ?? null,
    [editingTemplateId, templates],
  );
  const editingContractTypeOptions = useMemo(
    () => getTemplateTypeOptions(editingTemplate),
    [editingTemplate],
  );
  const createContractTypeOptions = useMemo(
    () => getFormatTypeOptions(contractTypePresets),
    [contractTypePresets],
  );

  const selectedFormat = useMemo(
    () =>
      selectedTemplate?.formats.find((format) => format.id === selectedFormatId) ?? null,
    [selectedTemplate, selectedFormatId],
  );

  useEffect(() => {
    const loadContractTypePresets = async () => {
      try {
        setContractTypePresetsLoading(true);
        setContractTypePresetsError("");

        const presets = await fetchBaseReportFormats();
        const normalizedPresets = presets.map((preset: any) => ({
          id: preset.id,
          name: preset.name,
          description: preset.description,
          fields: Array.isArray(preset.schema_json) ? preset.schema_json : [],
        }));

        setContractTypePresets(normalizedPresets);
      } catch (error) {
        console.error("Error loading contract type presets:", error);
        setContractTypePresets([]);
        setContractTypePresetsError(getErrorMessage(error));
      } finally {
        setContractTypePresetsLoading(false);
      }
    };

    void loadContractTypePresets();
  }, []);

  const resetEditContractState = () => {
    setEditingTemplateId("");
    setEditingContractName("");
    setEditingContractSelectedType("");
  };

  const closeEditContractDialog = () => {
    setIsEditContractOpen(false);
    resetEditContractState();
  };

  useEffect(() => {
    if (!selectedTemplate) return;

    if (!selectedFormat || !selectedTemplate.formats.some((format) => format.id === selectedFormat.id)) {
      setSelectedFormatId(selectedTemplate.defaultFormatId || selectedTemplate.formats[0]?.id || "");
    }
  }, [selectedTemplate, selectedFormat]);

  useEffect(() => {
    if (!createContractTypeOptions.length) return;

    if (!createContractTypeOptions.includes(newContractSelectedType)) {
      setNewContractSelectedType(createContractTypeOptions[0]);
    }
  }, [createContractTypeOptions, newContractSelectedType]);

  useEffect(() => {
    if (!editingTemplate || !editingContractTypeOptions.length) return;

    if (!editingContractTypeOptions.includes(editingContractSelectedType)) {
      setEditingContractSelectedType(getTemplateConfiguredType(editingTemplate));
    }
  }, [editingContractSelectedType, editingContractTypeOptions, editingTemplate]);

  useEffect(() => {
    setDynamicFields({});
  }, [selectedFormatId]);

  const canNext = () => {
    if (step === 1) return Boolean(selectedTemplate && selectedFormat);
    if (step === 2) {
      return Boolean(
        generalData.title &&
          generalData.recipient_name &&
          generalData.recipient_title &&
          generalData.sender_name &&
          generalData.sender_title &&
          generalData.subject &&
          generalData.inspection_date,
      );
    }
    if (step === 3 && selectedFormat) {
      return selectedFormat.fields.every((field) => {
        if (!field.required) return true;

        const value = dynamicFields[field.id];
        if (Array.isArray(value)) {
          return value.some((entry) => typeof entry === "string" && entry.trim());
        }

        return Boolean(value?.trim());
      });
    }

    return true;
  };

  const handleTemplateSelect = (template: ContractTemplate) => {
    setSelectedTemplateId(template.id);
    setSelectedFormatId(template.defaultFormatId || template.formats[0]?.id || "");
  };

  const openCreateContractDialog = () => {
    setCreateContractError("");
    setNewContractSelectedType(createContractTypeOptions[0] ?? "");
    setIsCreateContractOpen(true);
  };

  const handleRefreshContracts = async () => {
    try {
      setRefreshingContracts(true);
      await reloadTemplates();
      toast.success("Contratos actualizados");
    } catch (error) {
      console.error("Error refreshing contracts:", error);
      toast.error(`No se pudieron actualizar los contratos: ${getErrorMessage(error)}`);
    } finally {
      setRefreshingContracts(false);
    }
  };

  const handleCreateContract = async () => {
    const normalizedName = newContractName.trim();
    setCreateContractError("");

    if (!normalizedName) {
      toast.error("Ingresa el nombre del contrato");
      setCreateContractError("Ingresa el nombre del contrato.");
      return;
    }

    if (contractTypePresets.length === 0) {
      const message = contractTypePresetsError || "No hay tipos base disponibles en la base de datos.";
      toast.error(message);
      setCreateContractError(message);
      return;
    }

    const alreadyExists = templates.some(
      (template) => template.name.trim().toLowerCase() === normalizedName.toLowerCase(),
    );

    if (alreadyExists) {
      toast.error("Ese contrato ya existe");
      setCreateContractError("Ese contrato ya existe.");
      return;
    }

    try {
      setCreatingContract(true);
      const template = createContractTemplateFromFormats({
        name: normalizedName,
        iconName: newContractIconName,
        defaultType: newContractSelectedType,
        formats: contractTypePresets,
      });
      const savedTemplate = await createTemplate(template);
      const selectedFormat =
        savedTemplate.formats.find((format) => format.id === savedTemplate.defaultFormatId) ??
        savedTemplate.formats.find((format) => format.name === newContractSelectedType) ??
        savedTemplate.formats[0];

      setSelectedTemplateId(savedTemplate.id);
      setSelectedFormatId(selectedFormat?.id ?? "");
      setNewContractName("");
      setNewContractSelectedType(createContractTypeOptions[0] ?? "");
      setNewContractIconName(CONTRACT_ICON_OPTIONS[0].id);
      setCreateContractError("");
      setIsCreateContractOpen(false);
      toast.success(`Contrato ${normalizedName} creado`);
    } catch (error) {
      console.error("Error creating contract:", error);
      const errorMessage = getErrorMessage(error);
      setCreateContractError(errorMessage);
      toast.error(`Error al crear el contrato: ${errorMessage}`);
    } finally {
      setCreatingContract(false);
    }
  };

  const handleEditContract = (template: ContractTemplate) => {
    if (template.userId && template.userId !== user?.id) {
      toast.error("Solo puedes editar contratos creados por tu usuario");
      return;
    }

    setSelectedTemplateId(template.id);
    setEditingTemplateId(template.id);
    setEditingContractName(template.name);
    setEditingContractSelectedType(getTemplateConfiguredType(template));
    setIsEditContractOpen(true);
  };

  const handleSaveEditedContract = async () => {
    if (!editingTemplate) return;

    const normalizedName = editingContractName.trim();

    if (!normalizedName) {
      toast.error("Ingresa el nombre del contrato");
      return;
    }

    const alreadyExists = templates.some(
      (template) =>
        template.id !== editingTemplate.id &&
        template.name.trim().toLowerCase() === normalizedName.toLowerCase(),
    );

    if (alreadyExists) {
      toast.error("Ese contrato ya existe");
      return;
    }

    const nextDefaultFormatId = getTemplateDefaultFormatIdByType(
      editingTemplate,
      editingContractSelectedType,
    );

    try {
      await updateTemplate(editingTemplate.id, {
        ...editingTemplate,
        name: normalizedName,
        defaultFormatId: nextDefaultFormatId,
      });

      setSelectedTemplateId(editingTemplate.id);
      setSelectedFormatId(nextDefaultFormatId);
      closeEditContractDialog();
      toast.success(`Contrato ${normalizedName} actualizado`);
    } catch (error) {
      console.error("Error updating contract:", error);
      toast.error("Error al actualizar el contrato");
    }
  };

  const handleDeleteContract = async (template: ContractTemplate) => {
    if (template.userId && template.userId !== user?.id) {
      toast.error("Solo puedes eliminar contratos creados por tu usuario");
      return;
    }

    try {
      const usageCount = await checkTemplateUsageInInspections(template.id);

      if (usageCount > 0) {
        toast.error(getTemplateUsageMessage(usageCount));
        return;
      }

      setContractToDelete(template);
    } catch (error) {
      console.error("Error checking contract usage:", error);
      toast.error("No se pudo validar si el contrato tiene inspecciones asociadas");
    }
  };

  const confirmDeleteContract = async () => {
    if (!contractToDelete) return;

    const template = contractToDelete;
    setContractToDelete(null);

    try {
      await deleteTemplate(template.id);

      if (selectedTemplateId === template.id) {
        setSelectedTemplateId("");
        setSelectedFormatId("");
      }

      toast.success(`Contrato ${template.name} eliminado`);
    } catch (error) {
      console.error("Error deleting contract:", error);
      toast.error(getErrorMessage(error));
    }
  };

  const handleSave = async () => {
    if (!user || !selectedTemplate || !selectedFormat) return;
    setSubmitting(true);

    const inspectionDynamicFields = buildInspectionDynamicFields(
      selectedTemplate,
      selectedFormat,
      dynamicFields,
    );

    const evidenceEntries = extractInspectionEvidenceEntries(
      dynamicFields,
      selectedFormat.fields,
    );

    const { data: inspection, error } = await supabase
      .from("inspections")
      .insert({
        user_id: user.id,
        contract_type: selectedTemplate.name,
        template_id: selectedTemplate.id,
        format_id: selectedFormat.id,
        title: generalData.title,
        inspection_date: generalData.inspection_date,
        subject: generalData.subject,
        dynamic_fields: inspectionDynamicFields as unknown as any,
        status: "completed",
      })
      .select()
      .single();

    if (error || !inspection) {
      setSubmitting(false);
      toast.error(`Error al guardar inspeccion: ${error?.message ?? ""}`);
      return;
    }

    if (evidenceEntries.length > 0) {
      const { error: evidenceError } = await supabase
        .from("evidence")
        .insert(
          evidenceEntries.map((entry) => ({
            inspection_id: inspection.id,
            image_data: entry.imageData,
            image_url: null,
          })),
        );

      if (evidenceError) {
        await supabase.from("inspections").delete().eq("id", inspection.id);
        setSubmitting(false);
        toast.error(`Error al guardar las imagenes: ${evidenceError.message}`);
        return;
      }
    }

    setSubmitting(false);
    toast.success("Inspeccion guardada");
    navigate(`/inspections/${inspection.id}`);
  };

  return (
    <>
      <Header
        title="Nueva inspeccion"
        subtitle="Elige o crea un contrato y completa el formulario"
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 animate-fade-in sm:px-6 sm:py-8">
          <Stepper currentStep={step} />

          <Card className="shadow-soft-md">
            <CardContent className="p-4 sm:p-6 md:p-8">
              {step === 1 && (
                <Step1
                  templates={templates}
                  templatesError={templatesError}
                  templatesLoading={templatesLoading}
                  selectedTemplate={selectedTemplate}
                  currentUserId={user?.id ?? null}
                  refreshingContracts={refreshingContracts}
                  isEditMode={isEditMode}
                  onSelectTemplate={handleTemplateSelect}
                  onToggleEditMode={() => setIsEditMode((currentValue) => !currentValue)}
                  onEditTemplate={handleEditContract}
                  onDeleteTemplate={handleDeleteContract}
                  onRefreshTemplates={handleRefreshContracts}
                  onOpenCreateContract={openCreateContractDialog}
                />
              )}
              {step === 2 && <Step2 data={generalData} setData={setGeneralData} />}
              {step === 3 && (
                <Step3
                  format={selectedFormat}
                  values={dynamicFields}
                  setValues={setDynamicFields}
                />
              )}
              {step === 4 && (
                <Step4Summary
                  selectedTemplate={selectedTemplate}
                  selectedFormat={selectedFormat}
                  generalData={generalData}
                  dynamicFields={dynamicFields}
                />
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button
              variant="outline"
              onClick={() => (step === 1 ? navigate("/") : setStep(step - 1))}
              disabled={submitting}
              className="w-full sm:w-auto"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              {step === 1 ? "Cancelar" : "Anterior"}
            </Button>

            {step < 4 ? (
              <Button onClick={() => setStep(step + 1)} disabled={!canNext()} className="w-full sm:w-auto">
                Siguiente
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSave}
                disabled={submitting || !selectedTemplate || !selectedFormat}
                className="w-full sm:w-auto"
              >
                {submitting ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Check className="mr-1.5 h-4 w-4" />
                )}
                Guardar inspeccion
              </Button>
            )}
          </div>
        </div>
      </div>

      <CreateContractDialog
        open={isCreateContractOpen}
        contractName={newContractName}
        onContractNameChange={setNewContractName}
        onOpenChange={(open) => {
          setIsCreateContractOpen(open);
          if (!open) {
            setNewContractName("");
            setNewContractSelectedType(createContractTypeOptions[0] ?? "");
            setNewContractIconName(CONTRACT_ICON_OPTIONS[0].id);
            setCreateContractError("");
            setCreatingContract(false);
          }
        }}
        availableTypes={createContractTypeOptions}
        loadingTypes={contractTypePresetsLoading}
        selectedIconName={newContractIconName}
        selectedType={newContractSelectedType}
        onSelectedIconNameChange={setNewContractIconName}
        onSelectedTypeChange={setNewContractSelectedType}
        creating={creatingContract}
        errorMessage={createContractError || contractTypePresetsError}
        onCreate={handleCreateContract}
      />

      <Dialog
        open={isEditContractOpen}
        onOpenChange={(open) => {
          setIsEditContractOpen(open);
          if (!open) {
            resetEditContractState();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar contrato</DialogTitle>
            <DialogDescription>
              Modifica el nombre y el tipo predeterminado sin salir de Nueva inspeccion.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Field label="Nombre del contrato">
              <Input
                value={editingContractName}
                onChange={(event) => setEditingContractName(event.target.value)}
                placeholder="Ej. Inf.Insp.Arnes"
              />
            </Field>

            <div className="space-y-1.5">
              <Label className="text-xs">Tipo del contrato</Label>
              <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-muted/20 p-3">
                {editingContractTypeOptions.map((typeName) => (
                  <button
                    key={typeName}
                    type="button"
                    onClick={() => setEditingContractSelectedType(typeName)}
                    className={cn(
                      "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                      editingContractSelectedType === typeName
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground hover:border-primary/40",
                    )}
                  >
                    {typeName}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Este tipo sera el que quede seleccionado por defecto al usar el contrato.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeEditContractDialog}>
              Cancelar
            </Button>
            <Button
              onClick={handleSaveEditedContract}
              disabled={!editingTemplate || editingContractTypeOptions.length === 0}
            >
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={Boolean(contractToDelete)}
        onOpenChange={(open) => {
          if (!open) setContractToDelete(null);
        }}
        title="Eliminar contrato"
        description={
          contractToDelete
            ? `Se eliminara el contrato "${contractToDelete.name}" y ya no estara disponible para nuevas inspecciones.`
            : ""
        }
        confirmLabel="Eliminar"
        confirmTone="destructive"
        onConfirm={confirmDeleteContract}
      />
    </>
  );
};

const Stepper = ({ currentStep }: { currentStep: number }) => (
  <div className="overflow-x-auto pb-1">
    <div className="flex min-w-[320px] items-center justify-between gap-2">
      {STEPS.map((step, index) => {
        const done = currentStep > step.id;
        const active = currentStep === step.id;

        return (
          <div key={step.id} className="flex flex-1 items-center last:flex-none">
            <div className="flex min-w-[56px] flex-col items-center gap-1.5 text-center">
              <div
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary bg-primary-muted text-primary",
                  !done && !active && "border-border bg-card text-muted-foreground",
                )}
              >
                {done ? <Check className="h-4 w-4" /> : <step.icon className="h-4 w-4" />}
              </div>
              <span
                className={cn(
                  "text-[11px] font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </div>

            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  "mx-2 -mt-5 h-0.5 flex-1 transition-colors",
                  done ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  </div>
);

const Step1 = ({
  templates,
  templatesError,
  templatesLoading,
  selectedTemplate,
  currentUserId,
  refreshingContracts,
  isEditMode,
  onSelectTemplate,
  onToggleEditMode,
  onEditTemplate,
  onDeleteTemplate,
  onRefreshTemplates,
  onOpenCreateContract,
}: {
  templates: ContractTemplate[];
  templatesError: string | null;
  templatesLoading: boolean;
  selectedTemplate: ContractTemplate | null;
  currentUserId: string | null;
  refreshingContracts: boolean;
  isEditMode: boolean;
  onSelectTemplate: (template: ContractTemplate) => void;
  onToggleEditMode: () => void;
  onEditTemplate: (template: ContractTemplate) => void;
  onDeleteTemplate: (template: ContractTemplate) => void;
  onRefreshTemplates: () => void;
  onOpenCreateContract: () => void;
}) => {
  const canManageTemplate = (template: ContractTemplate) =>
    Boolean(currentUserId && (!template.userId || template.userId === currentUserId));
  const hasManageableTemplates = templates.some(canManageTemplate);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold">Contrato y tipo</h2>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefreshTemplates}
            disabled={templatesLoading || refreshingContracts}
            className="w-full sm:w-auto"
          >
            {refreshingContracts || templatesLoading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            Actualizar
          </Button>
          <Button size="sm" onClick={onOpenCreateContract} className="w-full sm:w-auto">
            <Plus className="mr-1.5 h-4 w-4" />
            Crear contrato
          </Button>
          {hasManageableTemplates && (
            <Button
              variant={isEditMode ? "default" : "outline"}
              size="sm"
              onClick={onToggleEditMode}
              className="w-full sm:w-auto"
            >
              <Pencil className="mr-1.5 h-4 w-4" />
              {isEditMode ? "Listo" : "Editar"}
            </Button>
          )}
        </div>
      </div>

      {templatesError ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertDescription>
            No se pudieron cargar los contratos: {templatesError}
          </AlertDescription>
        </Alert>
      ) : templatesLoading ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-muted-foreground" />
          <h3 className="text-base font-semibold">Cargando contratos</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Actualizando la lista de contratos disponibles.
          </p>
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <FolderKanban className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
          <h3 className="text-base font-semibold">No hay contratos configurados</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Crea uno aqui mismo indicando nombre, tipo base e icono para reutilizarlo despues.
          </p>
          <Button className="mt-5" onClick={onOpenCreateContract}>
            Crear contrato
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((template) => {
              const iconOption = getContractIconOption(template.iconName);
              const Icon = iconOption.Icon;
              const configuredType = getTemplateConfiguredType(template);

              return (
                <div
                  key={template.id}
                  className={cn(
                    "rounded-lg border-2 p-4 text-left transition-all",
                    selectedTemplate?.id === template.id
                      ? "border-primary bg-primary-muted shadow-soft-sm"
                      : "border-border bg-card hover:border-primary/50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectTemplate(template)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{template.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {template.description || "Sin descripcion"}
                          </p>
                          <p className="mt-2 text-xs font-medium text-foreground/80">
                            Tipo configurado: {configuredType}
                          </p>
                        </div>
                      </div>
                      <Badge variant="secondary">{template.formats.length}</Badge>
                    </div>
                  </button>

                  {isEditMode && canManageTemplate(template) && (
                    <div className="mt-3 flex gap-2 border-t border-border/70 pt-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => onEditTemplate(template)}
                      >
                        <Pencil className="mr-1.5 h-4 w-4" />
                        Editar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => onDeleteTemplate(template)}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Eliminar
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

const Step2 = ({
  data,
  setData,
}: {
  data: {
    title: string;
    recipient_name: string;
    recipient_title: string;
    sender_name: string;
    sender_title: string;
    subject: string;
    inspection_date: string;
  };
  setData: React.Dispatch<
    React.SetStateAction<{
      title: string;
      recipient_name: string;
      recipient_title: string;
      sender_name: string;
      sender_title: string;
      subject: string;
      inspection_date: string;
    }>
  >;
}) => (
  <div className="space-y-5">
    <div>
      <h2 className="text-lg font-semibold">Datos generales</h2>
      <p className="text-sm text-muted-foreground">
        Informacion principal que acompanara al formato elegido.
      </p>
    </div>

    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Titulo *">
        <Input
          value={data.title}
          onChange={(event) => setData({ ...data, title: event.target.value })}
          placeholder="Ej. INFORME N° 031 - 2026 / SSOMA"
        />
      </Field>

      <Field label="Fecha *">
        <Input
          type="date"
          value={data.inspection_date}
          onChange={(event) => setData({ ...data, inspection_date: event.target.value })}
        />
      </Field>

      <div className="md:col-span-2">
        <Card>
          <CardContent className="pt-6">
            <h3 className="font-semibold mb-4 text-base">PARA *</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nombre de la persona">
                <Input
                  value={data.recipient_name}
                  onChange={(event) => setData({ ...data, recipient_name: event.target.value })}
                  placeholder="Ej. Dra. Selene Torres Vilchez"
                />
              </Field>

              <Field label="Cargo">
                <Input
                  value={data.recipient_title}
                  onChange={(event) => setData({ ...data, recipient_title: event.target.value })}
                  placeholder="Ej. Responsable de Asuntos Corporativos & Gestion Humana"
                />
              </Field>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="md:col-span-2">
        <Card>
          <CardContent className="pt-6">
            <h3 className="font-semibold mb-4 text-base">DE *</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nombre de la persona">
                <Input
                  value={data.sender_name}
                  onChange={(event) => setData({ ...data, sender_name: event.target.value })}
                  placeholder="Ej. Jacson Cabanillas Espinoza"
                />
              </Field>

              <Field label="Cargo">
                <Input
                  value={data.sender_title}
                  onChange={(event) => setData({ ...data, sender_title: event.target.value })}
                  placeholder="Ej. Asistente SSOMA"
                />
              </Field>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="md:col-span-2">
        <Field label="Asunto *">
          <Input
            value={data.subject}
            onChange={(event) => setData({ ...data, subject: event.target.value })}
            placeholder="Ej. Inspeccion de los Arnes en AGUALIMA"
          />
        </Field>
      </div>
    </div>
  </div>
);

const Step3 = ({
  format,
  values,
  setValues,
}: {
  format: ReportFormatDefinition | null;
  values: Record<string, DynamicFieldValue>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, DynamicFieldValue>>>;
}) => {
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, string>>({});

  const handleImageFieldChange = async (
    fieldId: string,
    files: FileList | null,
    blockIndex?: number,
  ) => {
    if (!files || files.length === 0) return;

    const validFiles = Array.from(files).filter((file) => {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} no es una imagen válida`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    try {
      const imageDataUrls = await Promise.all(
        validFiles.map((file) => readFileAsDataUrl(file))
      );

      setValues((currentValues) => {
        const currentFieldValue = currentValues[fieldId];
        const currentArray = normalizeDynamicFieldArray(currentFieldValue);

        if (typeof blockIndex === "number") {
          const nextValues = currentArray.slice() as (string | string[])[];
          const blockValue = Array.isArray(nextValues[blockIndex]) ? nextValues[blockIndex] : [];
          nextValues[blockIndex] = [...blockValue, ...imageDataUrls];
          return {
            ...currentValues,
            [fieldId]: nextValues,
          };
        }

        return {
          ...currentValues,
          [fieldId]: [...currentArray, ...imageDataUrls],
        };
      });
    } catch {
      toast.error("No se pudo cargar las imágenes");
    }
  };

  const handleRepeatableFieldChange = (
    fieldId: string,
    blockIndex: number,
    value: string | string[],
  ) => {
    setValues((currentValues) => {
      const nextValues = [...normalizeDynamicFieldArray(currentValues[fieldId])];
      nextValues[blockIndex] = value;

      return {
        ...currentValues,
        [fieldId]: nextValues,
      };
    });
  };

  const handleAddBlock = (
    groupKey: string,
    groupFields: ReportFormatDefinition["fields"],
  ) => {
    const currentBlockCount = Math.max(
      1,
      ...groupFields.map((groupField) => normalizeDynamicFieldArray(values[groupField.id]).length),
    );

    setValues((currentValues) => {
      const nextValues = { ...currentValues };

      groupFields.forEach((groupField) => {
        nextValues[groupField.id] = [...normalizeDynamicFieldArray(currentValues[groupField.id]), ""];
      });

      return nextValues;
    });

    setExpandedBlocks((currentBlocks) => ({
      ...currentBlocks,
      [groupKey]: getRepeatableBlockValue(currentBlockCount),
    }));
  };

  const handleRemoveBlock = (
    groupKey: string,
    groupFields: ReportFormatDefinition["fields"],
    blockIndex: number,
  ) => {
    const currentBlockCount = Math.max(
      1,
      ...groupFields.map((groupField) => normalizeDynamicFieldArray(values[groupField.id]).length),
    );

    setValues((currentValues) => {
      const nextValues = { ...currentValues };

      groupFields.forEach((groupField) => {
        const updatedFieldValues = [...normalizeDynamicFieldArray(currentValues[groupField.id])];
        updatedFieldValues.splice(blockIndex, 1);
        nextValues[groupField.id] = updatedFieldValues;
      });

      return nextValues;
    });

    setExpandedBlocks((currentBlocks) => {
      const nextBlockCount = currentBlockCount - 1;
      const currentValue = currentBlocks[groupKey];

      if (currentValue === "") {
        return currentBlocks;
      }

      const currentIndex = currentValue ? getRepeatableBlockIndex(currentValue) : null;
      let nextExpandedIndex = Math.max(0, Math.min(blockIndex, nextBlockCount - 1));

      if (typeof currentIndex === "number") {
        if (currentIndex < blockIndex) {
          nextExpandedIndex = currentIndex;
        } else if (currentIndex > blockIndex) {
          nextExpandedIndex = currentIndex - 1;
        }
      }

      return {
        ...currentBlocks,
        [groupKey]: getRepeatableBlockValue(nextExpandedIndex),
      };
    });
  };

  useEffect(() => {
    if (!format) {
      setExpandedBlocks({});
      return;
    }

    setExpandedBlocks((currentBlocks) => {
      let hasChanges = false;
      const nextBlocks = { ...currentBlocks };
      const availableGroups = new Set<string>();

      format.fields.forEach((field) => {
        const groupKey = field.repeatableGroup;

        if (!groupKey || availableGroups.has(groupKey)) return;
        availableGroups.add(groupKey);

        const groupFields = format.fields.filter(
          (candidateField) => candidateField.repeatableGroup === groupKey,
        );
        const blockCount = Math.max(
          1,
          ...groupFields.map((groupField) => normalizeDynamicFieldArray(values[groupField.id]).length),
        );
        const currentValue = currentBlocks[groupKey];

        if (currentValue === undefined) {
          nextBlocks[groupKey] = getRepeatableBlockValue(0);
          hasChanges = true;
          return;
        }

        if (currentValue === "") return;

        const currentIndex = getRepeatableBlockIndex(currentValue);
        if (currentIndex === null || currentIndex >= blockCount) {
          nextBlocks[groupKey] = getRepeatableBlockValue(Math.max(0, blockCount - 1));
          hasChanges = true;
        }
      });

      Object.keys(nextBlocks).forEach((groupKey) => {
        if (!availableGroups.has(groupKey)) {
          delete nextBlocks[groupKey];
          hasChanges = true;
        }
      });

      return hasChanges ? nextBlocks : currentBlocks;
    });
  }, [format, values]);

  const renderSingleField = (field: ReportFormatDefinition["fields"][number]) => (
    <Field
      key={field.id}
      label={`${field.label}${field.required ? " *" : ""}`}
    >
      {field.type === "text" && (
        <Input
          value={typeof values[field.id] === "string" ? (values[field.id] as string) : ""}
          onChange={(event) =>
            setValues((currentValues) => ({
              ...currentValues,
              [field.id]: event.target.value,
            }))
          }
        />
      )}

      {field.type === "textarea" && (
        <RichTextEditor
          value={typeof values[field.id] === "string" ? (values[field.id] as string) : ""}
          onChange={(nextValue) =>
            setValues((currentValues) => ({
              ...currentValues,
              [field.id]: nextValue,
            }))
          }
          minHeightClassName="min-h-[120px]"
        />
      )}

      {field.type === "select" && (
        <Select
          value={typeof values[field.id] === "string" ? (values[field.id] as string) : ""}
          onValueChange={(value) =>
            setValues((currentValues) => ({
              ...currentValues,
              [field.id]: value,
            }))
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecciona una opcion" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {field.type === "radio" && (
        <RadioGroup
          value={typeof values[field.id] === "string" ? (values[field.id] as string) : ""}
          onValueChange={(value) =>
            setValues((currentValues) => ({
              ...currentValues,
              [field.id]: value,
            }))
          }
          className="flex flex-wrap gap-4"
        >
          {field.options.map((option) => (
            <div key={option} className="flex items-center gap-2">
              <RadioGroupItem value={option} id={`${field.id}-${option}`} />
              <Label htmlFor={`${field.id}-${option}`} className="font-normal">
                {option}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}

      {field.type === "image" && (
        <div className="space-y-3">
          <label 
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary hover:bg-accent/30"
            onDragOver={(e) => {
              e.preventDefault();
              e.currentTarget.classList.add("border-primary", "bg-accent/30");
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("border-primary", "bg-accent/30");
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("border-primary", "bg-accent/30");
              void handleImageFieldChange(field.id, e.dataTransfer.files);
            }}
          >
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">Subir imágenes</p>
            <p className="text-xs text-muted-foreground">PNG o JPG - Puedes seleccionar varias o arrastra aquí</p>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleImageFieldChange(field.id, event.target.files);
                event.target.value = "";
              }}
            />
          </label>

          {Array.isArray(values[field.id]) && (values[field.id] as string[]).length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {(values[field.id] as string[]).map((imageDataUrl, index) => (
                <div key={index} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                  <img
                    src={imageDataUrl}
                    alt={`${field.label} ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setValues((currentValues) => ({
                        ...currentValues,
                        [field.id]: (
                          normalizeDynamicFieldArray(currentValues[field.id])
                        ).filter((_, i) => i !== index),
                      }))
                    }
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Aun no se han cargado imágenes para este campo.
            </p>
          )}
        </div>
      )}
    </Field>
  );

  const renderRepeatableFieldControl = (
    groupField: ReportFormatDefinition["fields"][number],
    blockIndex: number,
    currentValue: string | string[],
    emptyImageText = "Aun no se han cargado imagenes para esta fila.",
  ) => (
    <>
      {groupField.type === "text" && (
        <Input
          value={typeof currentValue === "string" ? currentValue : ""}
          onChange={(event) =>
            handleRepeatableFieldChange(
              groupField.id,
              blockIndex,
              event.target.value,
            )
          }
        />
      )}

      {groupField.type === "textarea" && (
        <RichTextEditor
          value={typeof currentValue === "string" ? currentValue : ""}
          onChange={(nextValue) =>
            handleRepeatableFieldChange(
              groupField.id,
              blockIndex,
              nextValue,
            )
          }
          minHeightClassName="min-h-[120px]"
        />
      )}

      {groupField.type === "select" && (
        <Select
          value={typeof currentValue === "string" ? currentValue : ""}
          onValueChange={(value) =>
            handleRepeatableFieldChange(groupField.id, blockIndex, value)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecciona una opcion" />
          </SelectTrigger>
          <SelectContent>
            {groupField.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {groupField.type === "radio" && (
        <RadioGroup
          value={typeof currentValue === "string" ? currentValue : ""}
          onValueChange={(value) =>
            handleRepeatableFieldChange(groupField.id, blockIndex, value)
          }
          className="flex flex-wrap gap-4"
        >
          {groupField.options.map((option) => (
            <div key={option} className="flex items-center gap-2">
              <RadioGroupItem
                value={option}
                id={`${groupField.id}-${blockIndex}-${option}`}
              />
              <Label
                htmlFor={`${groupField.id}-${blockIndex}-${option}`}
                className="font-normal"
              >
                {option}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )}

      {groupField.type === "image" && (
        <div className="space-y-3">
          <label
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-4 text-center transition-colors hover:border-primary hover:bg-accent/30"
            onDragOver={(event) => {
              event.preventDefault();
              event.currentTarget.classList.add("border-primary", "bg-accent/30");
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.currentTarget.classList.remove("border-primary", "bg-accent/30");
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.currentTarget.classList.remove("border-primary", "bg-accent/30");
              void handleImageFieldChange(
                groupField.id,
                event.dataTransfer.files,
                blockIndex,
              );
            }}
          >
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium">Subir imagenes</p>
            <p className="text-xs text-muted-foreground">
              PNG o JPG - Puedes seleccionar varias o arrastra aqui
            </p>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleImageFieldChange(
                  groupField.id,
                  event.target.files,
                  blockIndex,
                );
                event.target.value = "";
              }}
            />
          </label>

          {Array.isArray(currentValue) && currentValue.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {currentValue.map((imageDataUrl, imageIndex) => (
                <div
                  key={imageIndex}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
                >
                  <img
                    src={imageDataUrl}
                    alt={`${groupField.label} ${imageIndex + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const images = currentValue.filter(
                        (entry): entry is string => typeof entry === "string",
                      );
                      const updated = images.filter((_, index) => index !== imageIndex);
                      handleRepeatableFieldChange(
                        groupField.id,
                        blockIndex,
                        updated,
                      );
                    }}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <X className="h-5 w-5 text-white" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{emptyImageText}</p>
          )}
        </div>
      )}
    </>
  );

  const renderTableGroup = (
    groupKey: string,
    groupFields: ReportFormatDefinition["fields"],
    blockCount: number,
  ) => {
    const nonImageFields = groupFields.filter((groupField) => groupField.type !== "image");
    const locationField =
      nonImageFields.find((groupField) =>
        groupField.label.toLowerCase().includes("ubic"),
      ) ??
      nonImageFields[0] ??
      groupFields[0];
    const statusFields = groupFields.filter((groupField) => groupField.id !== locationField?.id);

    return (
      <div key={groupKey} className="space-y-4 rounded-xl border border-border bg-muted/10 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">{getRepeatableGroupLabel(groupKey)}</h3>
            <p className="text-xs text-muted-foreground">
              Agrega filas para registrar ubicacion, estado e imagenes en formato de cuadro.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleAddBlock(groupKey, groupFields)}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Agregar fila
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="bg-[#fbbf24] text-black">
                <th className="w-16 border border-border px-3 py-2 text-center font-semibold">
                  Nº
                </th>
                <th className="w-56 border border-border px-3 py-2 text-center font-semibold uppercase">
                  {locationField?.label ?? "Ubicacion"}
                </th>
                <th className="border border-border px-3 py-2 text-center font-semibold uppercase">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: blockCount }, (_, blockIndex) => {
                const locationValue = locationField
                  ? normalizeDynamicFieldArray(values[locationField.id])[blockIndex] ?? ""
                  : "";

                return (
                  <tr key={`${groupKey}-row-${blockIndex}`} className="align-top">
                    <td className="border border-border px-3 py-4 text-center font-medium">
                      {String(blockIndex + 1).padStart(2, "0")}
                    </td>
                    <td className="border border-border px-3 py-4">
                      {locationField ? (
                        renderRepeatableFieldControl(locationField, blockIndex, locationValue)
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="border border-border px-3 py-4">
                      <div className="space-y-4">
                        {statusFields.length > 0 ? (
                          statusFields.map((statusField) => {
                            const blockValues = normalizeDynamicFieldArray(values[statusField.id]);
                            const currentValue = blockValues[blockIndex] ?? "";

                            return (
                              <div key={`${statusField.id}-${blockIndex}`} className="space-y-1.5">
                                <Label className="text-xs">
                                  {statusField.label}
                                  {statusField.required ? " *" : ""}
                                </Label>
                                {renderRepeatableFieldControl(
                                  statusField,
                                  blockIndex,
                                  currentValue,
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <span className="text-muted-foreground">Sin campos de estado.</span>
                        )}

                        {blockCount > 1 && (
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleRemoveBlock(groupKey, groupFields, blockIndex)}
                            >
                              <Trash2 className="mr-1.5 h-4 w-4" />
                              Eliminar fila
                            </Button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Campos del formato</h2>
        <p className="text-sm text-muted-foreground">
          Completa los campos definidos para el formato seleccionado.
        </p>
      </div>

      {!format ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm font-medium">Primero debes seleccionar un contrato.</p>
        </div>
      ) : format.fields.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm font-medium">Este formato no tiene campos configurados.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Puedes continuar o crear otro contrato si necesitas un formato con mas campos.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {(() => {
            const renderedGroups = new Set<string>();

            return format.fields.flatMap((field) => {
              // No renderizar campos isResultField ni campos de status-other
              if (field.isResultField || field.id.endsWith("-status-other")) {
                return [];
              }

              if (!field.repeatableGroup) {
                const elements = [renderSingleField(field)];
                
                // Si es un campo de estado/status y el valor es "Otro", mostrar campo adicional
                if (field.id.endsWith("-status") && values[field.id] === "Otro") {
                  const otherField = format.fields.find(f => f.id === field.id.replace("-status", "-status-other"));
                  if (otherField) {
                    elements.push(renderSingleField(otherField));
                  }
                }
                
                return elements;
              }

              if (renderedGroups.has(field.repeatableGroup)) return [];
              renderedGroups.add(field.repeatableGroup);

              const groupKey = field.repeatableGroup;
              const groupFields = format.fields.filter(
                (candidateField) => candidateField.repeatableGroup === groupKey,
              );
              const blockCount = Math.max(
                1,
                ...groupFields.map((groupField) => normalizeDynamicFieldArray(values[groupField.id]).length),
              );

              if (getRepeatableLayout(groupFields) === "table") {
                return renderTableGroup(groupKey, groupFields, blockCount);
              }

              return (
                <div key={groupKey} className="space-y-4 rounded-xl border border-border bg-muted/10 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">{getRepeatableGroupLabel(groupKey)}</h3>
                      <p className="text-xs text-muted-foreground">
                        Puedes agregar varios bloques para registrar mas elementos dentro de esta seccion.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleAddBlock(groupKey, groupFields)}
                    >
                      <Plus className="mr-1.5 h-4 w-4" />
                      Agregar bloque
                    </Button>
                  </div>

                  <Accordion
                    type="single"
                    collapsible
                    value={expandedBlocks[groupKey] ?? getRepeatableBlockValue(0)}
                    onValueChange={(value) =>
                      setExpandedBlocks((currentBlocks) => ({
                        ...currentBlocks,
                        [groupKey]: value,
                      }))
                    }
                    className="space-y-3"
                  >
                    {Array.from({ length: blockCount }, (_, blockIndex) => (
                      <AccordionItem
                        key={`${groupKey}-${blockIndex}`}
                        value={getRepeatableBlockValue(blockIndex)}
                        className="rounded-lg border border-border bg-card data-[state=open]:border-primary/40"
                      >
                        <div className="flex items-center gap-3 px-4">
                          <div className="min-w-0 flex-1">
                            <AccordionTrigger className="py-4 text-left hover:no-underline">
                              <div className="min-w-0">
                                <p className="text-sm font-medium">Bloque {blockIndex + 1}</p>
                                <p className="text-xs text-muted-foreground">
                                  Haz clic en la flecha para expandir o contraer este bloque.
                                </p>
                              </div>
                            </AccordionTrigger>
                          </div>

                          {blockCount > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="shrink-0 text-destructive hover:text-destructive"
                              onClick={() => handleRemoveBlock(groupKey, groupFields, blockIndex)}
                            >
                              <Trash2 className="mr-1.5 h-4 w-4" />
                              Eliminar bloque
                            </Button>
                          )}
                        </div>

                        <AccordionContent className="px-4 pb-4 pt-4">
                          <div className="grid gap-4">
                            {groupFields.map((groupField) => {
                              const blockValues = normalizeDynamicFieldArray(values[groupField.id]);
                              const currentValue = blockValues[blockIndex] ?? "";

                              return (
                                <Field
                                  key={`${groupField.id}-${blockIndex}`}
                                  label={`${groupField.label}${groupField.required ? " *" : ""}`}
                                >
                                  {groupField.type === "text" && (
                                    <Input
                                      value={currentValue}
                                      onChange={(event) =>
                                        handleRepeatableFieldChange(
                                          groupField.id,
                                          blockIndex,
                                          event.target.value,
                                        )
                                      }
                                    />
                                  )}

                                  {groupField.type === "textarea" && (
                                    <RichTextEditor
                                      value={typeof currentValue === "string" ? currentValue : ""}
                                      onChange={(nextValue) =>
                                        handleRepeatableFieldChange(
                                          groupField.id,
                                          blockIndex,
                                          nextValue,
                                        )
                                      }
                                      minHeightClassName="min-h-[120px]"
                                    />
                                  )}

                                  {groupField.type === "select" && (
                                    <Select
                                      value={typeof currentValue === "string" ? currentValue : ""}
                                      onValueChange={(value) =>
                                        handleRepeatableFieldChange(groupField.id, blockIndex, value)
                                      }
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder="Selecciona una opcion" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {groupField.options.map((option) => (
                                          <SelectItem key={option} value={option}>
                                            {option}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}

                                  {groupField.type === "radio" && (
                                    <RadioGroup
                                      value={typeof currentValue === "string" ? currentValue : ""}
                                      onValueChange={(value) =>
                                        handleRepeatableFieldChange(groupField.id, blockIndex, value)
                                      }
                                      className="flex flex-wrap gap-4"
                                    >
                                      {groupField.options.map((option) => (
                                        <div key={option} className="flex items-center gap-2">
                                          <RadioGroupItem
                                            value={option}
                                            id={`${groupField.id}-${blockIndex}-${option}`}
                                          />
                                          <Label
                                            htmlFor={`${groupField.id}-${blockIndex}-${option}`}
                                            className="font-normal"
                                          >
                                            {option}
                                          </Label>
                                        </div>
                                      ))}
                                    </RadioGroup>
                                  )}

                                  {groupField.type === "image" && (
                                    <div className="space-y-3">
                                      <label 
                                        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary hover:bg-accent/30"
                                        onDragOver={(e) => {
                                          e.preventDefault();
                                          e.currentTarget.classList.add("border-primary", "bg-accent/30");
                                        }}
                                        onDragLeave={(e) => {
                                          e.preventDefault();
                                          e.currentTarget.classList.remove("border-primary", "bg-accent/30");
                                        }}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          e.currentTarget.classList.remove("border-primary", "bg-accent/30");
                                          void handleImageFieldChange(
                                            groupField.id,
                                            e.dataTransfer.files,
                                            blockIndex,
                                          );
                                        }}
                                      >
                                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                                        <p className="text-sm font-medium">Subir imágenes</p>
                                        <p className="text-xs text-muted-foreground">PNG o JPG - Puedes seleccionar varias o arrastra aquí</p>
                                        <input
                                          type="file"
                                          accept="image/*"
                                          multiple
                                          className="hidden"
                                          onChange={(event) => {
                                            void handleImageFieldChange(
                                              groupField.id,
                                              event.target.files,
                                              blockIndex,
                                            );
                                            event.target.value = "";
                                          }}
                                        />
                                      </label>

                                      {Array.isArray(currentValue) && (currentValue as string[]).length > 0 ? (
                                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                                          {(currentValue as string[]).map((imageDataUrl, imageIndex) => (
                                            <div key={imageIndex} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                                              <img
                                                src={imageDataUrl}
                                                alt={`${groupField.label} ${imageIndex + 1}`}
                                                className="h-full w-full object-cover"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const images = normalizeDynamicFieldArray(currentValue);
                                                  const updated = images.filter((_, i) => i !== imageIndex);
                                                  handleRepeatableFieldChange(
                                                    groupField.id,
                                                    blockIndex,
                                                    updated,
                                                  );
                                                }}
                                                className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                                              >
                                                <X className="h-5 w-5 text-white" />
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-xs text-muted-foreground">
                                          Aun no se han cargado imágenes para este bloque.
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </Field>
                              );
                            })}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
};

const Step4Summary = ({
  selectedTemplate,
  selectedFormat,
  generalData,
  dynamicFields,
}: {
  selectedTemplate: ContractTemplate | null;
  selectedFormat: ReportFormatDefinition | null;
  generalData: {
    title: string;
    recipient_name: string;
    recipient_title: string;
    sender_name: string;
    sender_title: string;
    subject: string;
    inspection_date: string;
  };
  dynamicFields: Record<string, DynamicFieldValue>;
}) => (
  <div className="space-y-5">
    <div>
      <h2 className="text-lg font-semibold">Resumen y guardado</h2>
      <p className="text-sm text-muted-foreground">
        Revisa el contrato, el formato y los datos antes de guardar.
      </p>
    </div>

    <div className="space-y-4 text-sm">
      <SummaryRow label="Contrato" value={selectedTemplate?.name ?? "-"} />
      <SummaryRow label="Tipo" value={selectedFormat?.name ?? "-"} />
      <SummaryRow label="Titulo" value={generalData.title || "-"} />
      <SummaryRow label="Para (Nombre)" value={generalData.recipient_name || "-"} />
      <SummaryRow label="Para (Cargo)" value={generalData.recipient_title || "-"} />
      <SummaryRow label="DE (Nombre)" value={generalData.sender_name || "-"} />
      <SummaryRow label="DE (Cargo)" value={generalData.sender_title || "-"} />
      <SummaryRow label="Asunto" value={generalData.subject || "-"} />
      <SummaryRow label="Fecha" value={generalData.inspection_date || "-"} />
      <SummaryRow
        label="Campos completados"
        value={`${countFilledDynamicValues(dynamicFields)}`}
      />
    </div>
  </div>
);

const CreateContractDialog = ({
  open,
  contractName,
  availableTypes,
  loadingTypes,
  selectedIconName,
  selectedType,
  onContractNameChange,
  onSelectedIconNameChange,
  onSelectedTypeChange,
  onOpenChange,
  creating,
  errorMessage,
  onCreate,
}: {
  open: boolean;
  contractName: string;
  availableTypes: string[];
  loadingTypes: boolean;
  selectedIconName: string;
  selectedType: string;
  onContractNameChange: (value: string) => void;
  onSelectedIconNameChange: (value: string) => void;
  onSelectedTypeChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  creating: boolean;
  errorMessage: string;
  onCreate: () => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Crear contrato</DialogTitle>
        <DialogDescription>
          Crea un contrato nuevo para reutilizarlo luego en otras inspecciones.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {errorMessage ? (
          <Alert variant="destructive">
            <CircleAlert className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <Field label="Nombre del contrato">
          <Input
            value={contractName}
            onChange={(event) => onContractNameChange(event.target.value)}
            placeholder="Ej. Inf.Insp.Arnes"
          />
        </Field>

        <div className="space-y-1.5">
          <Label className="text-xs">Tipo por defecto del contrato</Label>
          <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-muted/20 p-3">
            {availableTypes.map((typeName) => (
              <button
                key={typeName}
                type="button"
                onClick={() => onSelectedTypeChange(typeName)}
                className={cn(
                  "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                  selectedType === typeName
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:border-primary/40",
                )}
              >
                {typeName}
              </button>
            ))}
            {!loadingTypes && availableTypes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No hay tipos base disponibles.
              </p>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Aqui defines cual de los tipos disponibles quedara seleccionado por defecto al usar el contrato.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Icono del contrato</Label>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-4">
            {CONTRACT_ICON_OPTIONS.map((option) => {
              const Icon = option.Icon;

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelectedIconNameChange(option.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                    selectedIconName === option.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:border-primary/40",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            El icono te ayuda a identificar rapido el contrato en la lista.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
          Cancelar
        </Button>
        <Button onClick={onCreate} disabled={creating || loadingTypes || availableTypes.length === 0}>
          {creating ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Creando...
            </>
          ) : loadingTypes ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Cargando tipos...
            </>
          ) : (
            "Crear contrato"
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between border-b border-border py-2 last:border-0">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium">{value}</span>
  </div>
);

const Field = ({
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

export default NewInspection;
