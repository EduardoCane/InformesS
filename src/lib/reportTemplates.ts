import { DEFAULT_CONTRACT_ICON_ID } from "./contractIcons";

export type ContractFieldType = "text" | "textarea" | "select" | "radio" | "image";
export type RepeatableLayout = "blocks" | "table";

export interface ContractFieldDefinition {
  id: string;
  label: string;
  type: ContractFieldType;
  options: string[];
  required: boolean;
  isResultField: boolean;
  repeatableGroup?: string | null;
  repeatableLayout?: RepeatableLayout;
  imageLayout?: "rows" | "grid3x3";
}

export interface ReportFormatDefinition {
  id: string;
  name: string;
  description: string;
  fields: ContractFieldDefinition[];
}

export interface ContractTemplate {
  id: string;
  userId?: string | null;
  name: string;
  description: string;
  iconName: string;
  defaultFormatId: string;
  createdAt: string;
  updatedAt: string;
  formats: ReportFormatDefinition[];
}

export interface InspectionFormatSnapshot {
  templateId: string | null;
  templateName: string;
  formatId: string | null;
  formatName: string | null;
  formatDescription: string | null;
  fields: ContractFieldDefinition[];
}

export interface InspectionEvidenceEntry {
  fieldId: string;
  blockIndex: number | null;
  imageData: string;
}

export type InspectionFormatSection =
  | {
      type: "field";
      field: ContractFieldDefinition;
      value: unknown;
    }
  | {
      type: "group";
      groupKey: string;
      fields: ContractFieldDefinition[];
      blocks: Array<{
        index: number;
        entries: Array<{
          field: ContractFieldDefinition;
          value: unknown;
        }>;
      }>;
    };

export const DEFAULT_REPEATABLE_GROUP_KEY = "activity-block";
export const DEFAULT_REPEATABLE_TABLE_GROUP_KEY = "Cuadro de inspeccion";
export const getRepeatableGroupLabel = (groupKey: string | null | undefined) =>
  !groupKey || groupKey === DEFAULT_REPEATABLE_GROUP_KEY
    ? "Bloques del documento"
    : groupKey === DEFAULT_REPEATABLE_TABLE_GROUP_KEY
      ? "Cuadro de inspeccion"
    : groupKey;

export const getRepeatableLayout = (
  fields: Pick<ContractFieldDefinition, "repeatableLayout">[],
): RepeatableLayout =>
  fields.some((field) => field.repeatableLayout === "table") ? "table" : "blocks";

const STORAGE_KEY = "inspectpro.contract-templates.v2";

const META_KEYS = {
  templateId: "__templateId",
  templateName: "__templateName",
  formatId: "__formatId",
  formatName: "__formatName",
  formatDescription: "__formatDescription",
  schema: "__formatSchema",
  generalPhoto: "__generalPhoto",
} as const;

const META_KEY_SET = new Set<string>(Object.values(META_KEYS));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const uniqueId = () => crypto.randomUUID();

const getDefaultFormatName = (index: number) => `Formato ${index + 1}`;

const getDefaultFormatDescription = () => "Formato personalizado.";

const normalizeOptions = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((option) => String(option).trim())
    .filter(Boolean);
};

const ensureSingleResultField = (fields: ContractFieldDefinition[]): ContractFieldDefinition[] => {
  let resultFieldFound = false;

  return fields.map((field) => {
    if (!field.isResultField) return field;
    if (resultFieldFound) return { ...field, isResultField: false };

    resultFieldFound = true;
    return field;
  });
};

const normalizeField = (field: Partial<ContractFieldDefinition>): ContractFieldDefinition => {
  const type: ContractFieldType =
    field.type === "textarea" ||
    field.type === "select" ||
    field.type === "radio" ||
    field.type === "image"
      ? field.type
      : "text";
  const repeatableGroup =
    typeof field.repeatableGroup === "string" && field.repeatableGroup.trim()
      ? field.repeatableGroup.trim()
      : null;
  const repeatableLayout: RepeatableLayout | undefined = repeatableGroup
    ? field.repeatableLayout === "table"
      ? "table"
      : "blocks"
    : undefined;
  
  // Para imageLayout: mantener el valor si es válido, sino asignar default para nuevos campos
  let imageLayout: "rows" | "grid3x3" | undefined;
  if (type === "image") {
    if (field.imageLayout === "rows" || field.imageLayout === "grid3x3") {
      imageLayout = field.imageLayout;
    } else if (field.imageLayout === undefined) {
      // Solo asignar default si NO viene de la base de datos (cuando es undefined)
      // Si viene de la BD, normalizeField será llamado después del mapeo que ya incluye imageLayout
      imageLayout = "grid3x3";
    }
  }

  return {
    id: typeof field.id === "string" && field.id.trim() ? field.id : uniqueId(),
    label:
      typeof field.label === "string" && field.label.trim()
        ? field.label.trim()
        : "Nuevo campo",
    type,
    options: normalizeOptions(field.options),
    required: Boolean(field.required),
    isResultField: repeatableGroup || type === "image" ? false : Boolean(field.isResultField),
    repeatableGroup,
    repeatableLayout,
    imageLayout,
  };
};

const buildNormalStarterFields = (prefix: string): ContractFieldDefinition[] =>
  ensureSingleResultField([
    normalizeField({
      id: `${prefix}-initial-description`,
      label: "Descripcion inicial",
      type: "textarea",
    }),
    normalizeField({
      id: `${prefix}-labor`,
      label: "Labor",
      type: "text",
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-position`,
      label: "Puesto",
      type: "text",
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-observations`,
      label: "Observaciones",
      type: "textarea",
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-recommendations`,
      label: "Recomendaciones",
      type: "textarea",
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-images`,
      label: "Imagenes",
      type: "image",
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-final-conclusions`,
      label: "Conclusiones y recomendaciones",
      type: "textarea",
    }),
  ]);

const buildStarterFields = (prefix: string): ContractFieldDefinition[] =>
  ensureSingleResultField([
    normalizeField({
      id: `${prefix}-area`,
      label: "Area",
      type: "text",
      required: true,
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-responsable`,
      label: "Ubicación",
      type: "text",
      required: true,
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-status`,
      label: "Estado",
      type: "select",
      options: ["Correcto", "Extintor enviado a recargar", "Otro"],
      required: true,
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-status-other`,
      label: "Especificar estado",
      type: "text",
      required: false,
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-images`,
      label: "Imágenes",
      type: "image",
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
  ]);

const buildCompletoStarterFields = (prefix: string): ContractFieldDefinition[] =>
  ensureSingleResultField([
    normalizeField({
      id: `${prefix}-initial-description`,
      label: "Descripcion inicial",
      type: "textarea",
    }),
    normalizeField({
      id: `${prefix}-area`,
      label: "Area",
      type: "text",
      required: true,
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-responsable`,
      label: "Responsable",
      type: "text",
      required: true,
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-harness-line`,
      label: "Serie de arnes|Linea vida",
      type: "text",
      required: true,
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-production-date`,
      label: "Fecha de Produccion",
      type: "text",
      required: true,
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-observations`,
      label: "Observaciones",
      type: "textarea",
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
    normalizeField({
      id: `${prefix}-images`,
      label: "Fotos",
      type: "image",
      repeatableGroup: DEFAULT_REPEATABLE_GROUP_KEY,
    }),
  ]);

const isLegacyNormalStarterFields = (fields: Partial<ContractFieldDefinition>[]) => {
  if (!Array.isArray(fields) || fields.length !== 3) return false;

  const summary = fields.map((field) => ({
    label: typeof field.label === "string" ? field.label.trim() : "",
    type: field.type,
  }));

  return (
    summary[0]?.label === "Tema revisado" &&
    summary[0]?.type === "text" &&
    summary[1]?.label === "Observaciones" &&
    summary[1]?.type === "textarea" &&
    summary[2]?.label === "Resultado" &&
    summary[2]?.type === "radio"
  );
};

const isLegacyCompletoStarterFields = (fields: Partial<ContractFieldDefinition>[]) => {
  if (!Array.isArray(fields) || fields.length !== 5) return false;

  const summary = fields.map((field) => ({
    id: typeof field.id === "string" ? field.id.trim() : "",
    label: typeof field.label === "string" ? field.label.trim() : "",
    type: field.type,
  }));

  return (
    summary[0]?.id.endsWith("-subject") &&
    summary[0]?.label === "Tema revisado" &&
    summary[0]?.type === "text" &&
    summary[1]?.id.endsWith("-location") &&
    summary[1]?.type === "text" &&
    summary[2]?.id.endsWith("-status") &&
    summary[2]?.label === "Estado" &&
    summary[2]?.type === "select" &&
    summary[3]?.id.endsWith("-status-other") &&
    summary[3]?.label === "Especificar estado" &&
    summary[3]?.type === "text" &&
    summary[4]?.id.endsWith("-images") &&
    summary[4]?.type === "image"
  );
};

const ensureCompletoFormatFields = (fields: ContractFieldDefinition[]): ContractFieldDefinition[] => {
  if (isLegacyCompletoStarterFields(fields)) {
    const prefix = fields[0]?.id.split("-").slice(0, -1).join("-") || "completo-0";
    return buildCompletoStarterFields(prefix);
  }

  // Verificar si falta el campo "Descripcion inicial"
  const hasInitialDescription = fields.some((field) => field.id.endsWith("-initial-description"));
  if (!hasInitialDescription && fields.length > 0) {
    // Obtener el prefijo del primer campo
    const firstFieldId = fields[0]?.id || "";
    const prefix = firstFieldId.split("-").slice(0, -1).join("-") || "completo";
    
    // Insertar el campo de descripción inicial al principio
    const initialDescriptionField = normalizeField({
      id: `${prefix}-initial-description`,
      label: "Descripcion inicial",
      type: "textarea",
    });
    
    return [initialDescriptionField, ...fields];
  }

  return fields;
};

const createFormat = (
  name: string,
  description: string,
  fields: ContractFieldDefinition[],
): ReportFormatDefinition => ({
  id: uniqueId(),
  name,
  description,
  fields: ensureSingleResultField(fields.map((field) => normalizeField(field))),
});

const ensureFormats = (
  formats: Partial<ReportFormatDefinition>[] | undefined,
): ReportFormatDefinition[] => {
  const normalized = Array.isArray(formats)
    ? formats.map((format, index) => {
        const formatName = typeof format.name === "string" && format.name.trim()
          ? format.name.trim()
          : getDefaultFormatName(index);
        
        let fields = Array.isArray(format.fields) ? format.fields : [];
        
        // Si es formato Completo, asegurar que tenga todos los campos necesarios
        if (formatName === "Completo" && fields.length > 0) {
          const normalizedFields = fields.map((field) => normalizeField(field));
          fields = ensureCompletoFormatFields(normalizedFields);
        } else if (formatName === "Normal" && isLegacyNormalStarterFields(fields)) {
          fields = buildNormalStarterFields(`${formatName.toLowerCase()}-${index}`);
        } else {
          fields = fields.map((field) => normalizeField(field));
        }

        return {
          id: typeof format.id === "string" && format.id.trim() ? format.id : uniqueId(),
          name: formatName,
          description:
            typeof format.description === "string" && format.description.trim()
              ? format.description.trim()
              : getDefaultFormatDescription(),
          fields: ensureSingleResultField(fields),
        };
      })
    : [];

  return normalized;
};

const normalizeTemplate = (template: Partial<ContractTemplate>): ContractTemplate => ({
  ...(() => {
    const formats = ensureFormats(template.formats);
    const defaultFormatId =
      typeof template.defaultFormatId === "string" &&
      formats.some((format) => format.id === template.defaultFormatId)
        ? template.defaultFormatId
        : formats[0]?.id ?? "";

    return {
      id: typeof template.id === "string" && template.id.trim() ? template.id : uniqueId(),
      name:
        typeof template.name === "string" && template.name.trim()
          ? template.name.trim()
          : "Nuevo contrato",
      description:
        typeof template.description === "string" && template.description.trim()
          ? template.description.trim()
          : "",
      iconName:
        typeof template.iconName === "string" && template.iconName.trim()
          ? template.iconName
          : DEFAULT_CONTRACT_ICON_ID,
      defaultFormatId,
      createdAt:
        typeof template.createdAt === "string" && template.createdAt.trim()
          ? template.createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof template.updatedAt === "string" && template.updatedAt.trim()
          ? template.updatedAt
          : new Date().toISOString(),
      formats,
    };
  })(),
});

export const applyNormalFormatPresetMigration = (
  templates: ContractTemplate[],
): ContractTemplate[] =>
  templates.map((template) => ({
    ...template,
    updatedAt: new Date().toISOString(),
    formats: template.formats.map((format, index) =>
      index === 0
        ? {
            ...format,
            name: "Normal",
            fields: buildNormalStarterFields(`${template.id}-normal`),
          }
        : format,
    ),
  }));

export const createContractFormat = ({
  name = "Nuevo tipo",
  description = "Formato personalizado.",
  fields = [],
}: {
  name?: string;
  description?: string;
  fields?: ContractFieldDefinition[];
} = {}): ReportFormatDefinition =>
  createFormat(name, description, fields);

const FORMAT_FIELD_SUFFIXES_TO_PRESERVE = [
  "-initial-description",
  "-final-conclusions",
  "-production-date",
  "-harness-line",
  "-status-other",
  "-recommendations",
  "-observations",
  "-responsable",
  "-location",
  "-position",
  "-images",
  "-status",
  "-labor",
  "-area",
] as const;

const getClonedFieldId = (fieldId: string) => {
  const suffix =
    FORMAT_FIELD_SUFFIXES_TO_PRESERVE.find((candidateSuffix) =>
      fieldId.endsWith(candidateSuffix),
    ) ?? "";

  return `${uniqueId()}${suffix}`;
};

export const cloneContractFormat = (
  sourceFormat: ReportFormatDefinition,
  {
    name = `${sourceFormat.name} copia`,
    description = sourceFormat.description || getDefaultFormatDescription(),
  }: {
    name?: string;
    description?: string;
  } = {},
): ReportFormatDefinition =>
  createFormat(
    name,
    description,
    sourceFormat.fields.map((field) => ({
      ...field,
      id: getClonedFieldId(field.id),
      options: [...field.options],
      repeatableGroup: field.repeatableGroup ?? null,
      repeatableLayout: field.repeatableLayout,
      imageLayout: field.imageLayout,
    })),
  );

export const createContractField = (): ContractFieldDefinition =>
  normalizeField({
    label: "Nuevo campo",
    type: "text",
  });

export const createContractTableFields = (
  groupName = DEFAULT_REPEATABLE_TABLE_GROUP_KEY,
): ContractFieldDefinition[] => {
  const prefix = uniqueId();
  const repeatableGroup = groupName.trim() || DEFAULT_REPEATABLE_TABLE_GROUP_KEY;

  return [
    normalizeField({
      id: `${prefix}-location`,
      label: "Ubicacion",
      type: "text",
      required: true,
      repeatableGroup,
      repeatableLayout: "table",
    }),
    normalizeField({
      id: `${prefix}-status`,
      label: "Estado",
      type: "textarea",
      required: true,
      repeatableGroup,
      repeatableLayout: "table",
    }),
    normalizeField({
      id: `${prefix}-images`,
      label: "Imagenes",
      type: "image",
      repeatableGroup,
      repeatableLayout: "table",
      imageLayout: "rows",
    }),
  ];
};

export const createContractTemplateFromFormats = ({
  name = "Nuevo contrato",
  description = "",
  iconName = DEFAULT_CONTRACT_ICON_ID,
  defaultType = "",
  formats = [],
}: {
  name?: string;
  description?: string;
  iconName?: string;
  defaultType?: string;
  formats?: ReportFormatDefinition[];
} = {}): ContractTemplate => {
  const clonedTemplate = normalizeTemplate({
    name,
    description,
    iconName,
    formats: formats.map((format) => ({
      id: format.id,
      name: format.name,
      description: format.description,
      fields: format.fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        options: [...field.options],
        required: field.required,
        isResultField: field.isResultField,
        repeatableGroup: field.repeatableGroup ?? null,
        repeatableLayout: field.repeatableLayout,
        imageLayout: field.imageLayout,
      })),
    })),
  });
  const defaultFormat =
    clonedTemplate.formats.find((format) => format.name === defaultType) ??
    clonedTemplate.formats[0];

  return {
    ...clonedTemplate,
    defaultFormatId: defaultFormat?.id ?? clonedTemplate.defaultFormatId,
  };
};

export const loadContractTemplates = (): ContractTemplate[] => {
  if (typeof window === "undefined") return [];

  const storedValue = window.localStorage.getItem(STORAGE_KEY);
  if (!storedValue) return [];

  try {
    const parsed = JSON.parse(storedValue);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((template) =>
      normalizeTemplate(isRecord(template) ? template : {}),
    );
  } catch {
    return [];
  }
};

export const saveContractTemplates = (templates: ContractTemplate[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
};

export const getContractTemplateStorageKey = () => STORAGE_KEY;

export const buildInspectionDynamicFields = (
  template: ContractTemplate,
  format: ReportFormatDefinition,
  values: Record<string, unknown>,
) => {
  const payload: Record<string, unknown> = {
    [META_KEYS.templateId]: template.id,
    [META_KEYS.templateName]: template.name,
    [META_KEYS.formatId]: format.id,
    [META_KEYS.formatName]: format.name,
    [META_KEYS.formatDescription]: format.description,
    [META_KEYS.schema]: format.fields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      options: field.options,
      required: field.required,
      isResultField: field.isResultField,
      repeatableGroup: field.repeatableGroup ?? null,
      repeatableLayout: field.repeatableLayout,
      imageLayout: field.imageLayout,
    })),
  };

  format.fields.forEach((field) => {
    payload[field.id] = values[field.id] ?? "";
  });

  return payload;
};

export const readInspectionGeneralPhoto = (dynamicFields: unknown): string | null => {
  const record = isRecord(dynamicFields) ? dynamicFields : {};
  const rawValue = record[META_KEYS.generalPhoto];

  return typeof rawValue === "string" && rawValue ? rawValue : null;
};

export const readInspectionFormatSnapshot = (
  dynamicFields: unknown,
  fallbackTemplateName: string,
): InspectionFormatSnapshot => {
  const record = isRecord(dynamicFields) ? dynamicFields : {};
  const rawSchemaValue = record[META_KEYS.schema];
  const rawSchema = Array.isArray(rawSchemaValue) ? (rawSchemaValue as unknown[]) : [];
  const templateId = record[META_KEYS.templateId];
  const templateName = record[META_KEYS.templateName];
  const formatId = record[META_KEYS.formatId];
  const formatName = record[META_KEYS.formatName];
  const formatDescription = record[META_KEYS.formatDescription];

  return {
    templateId: typeof templateId === "string" ? templateId : null,
    templateName:
      typeof templateName === "string" && templateName ? templateName : fallbackTemplateName,
    formatId: typeof formatId === "string" ? formatId : null,
    formatName: typeof formatName === "string" ? formatName : null,
    formatDescription: typeof formatDescription === "string" ? formatDescription : null,
    fields: ensureSingleResultField(
      rawSchema.map((field) => normalizeField(isRecord(field) ? field : {}))
    ),
  };
};

export const getInspectionFieldEntries = (
  dynamicFields: unknown,
  fields: ContractFieldDefinition[] = [],
): Array<[string, unknown]> => {
  const record = isRecord(dynamicFields) ? dynamicFields : {};
  const singleFields = fields.filter((field) => !field.repeatableGroup);
  const orderedEntries = singleFields.map((field) => [field.id, record[field.id]] as [string, unknown]);
  const orderedKeys = new Set(fields.map((field) => field.id));
  const remainingEntries = Object.entries(record).filter(
    ([key]) => !META_KEY_SET.has(key) && !orderedKeys.has(key),
  );

  return [...orderedEntries, ...remainingEntries];
};

const normalizeRepeatableValues = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value) return [value];
  return [];
};

const tryParseJsonArray = (value: string): unknown => {
  const trimmedValue = value.trim();
  if (!trimmedValue.startsWith("[")) return value;

  try {
    const parsedValue = JSON.parse(trimmedValue);
    return Array.isArray(parsedValue) ? parsedValue : value;
  } catch {
    return value;
  }
};

export const getInspectionImageSources = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => getInspectionImageSources(entry));
  }

  if (typeof value !== "string") return [];

  const trimmedValue = value.trim();
  if (!trimmedValue) return [];

  if (trimmedValue.startsWith("[")) {
    return getInspectionImageSources(tryParseJsonArray(trimmedValue));
  }

  return [trimmedValue];
};

export const extractInspectionEvidenceEntries = (
  values: Record<string, unknown>,
  fields: ContractFieldDefinition[],
): InspectionEvidenceEntry[] => {
  const imageFields = fields.filter((field) => field.type === "image");

  return imageFields.flatMap((field) => {
    const rawValue = values[field.id];

    if (!field.repeatableGroup) {
      return getInspectionImageSources(rawValue).map((imageData) => ({
        fieldId: field.id,
        blockIndex: null,
        imageData,
      }));
    }

    const blockValues = Array.isArray(rawValue)
      ? rawValue
      : typeof rawValue === "string" && rawValue
        ? [rawValue]
        : [];

    return blockValues.flatMap((blockValue, blockIndex) =>
      getInspectionImageSources(blockValue).map((imageData) => ({
        fieldId: field.id,
        blockIndex,
        imageData,
      })),
    );
  });
};

export const getInspectionFormatSections = (
  dynamicFields: unknown,
  fields: ContractFieldDefinition[] = [],
): InspectionFormatSection[] => {
  const record = isRecord(dynamicFields) ? dynamicFields : {};
  const sections: InspectionFormatSection[] = [];
  const processedGroups = new Set<string>();

  fields.forEach((field) => {
    if (!field.repeatableGroup) {
      sections.push({
        type: "field",
        field,
        value: record[field.id],
      });
      return;
    }

    if (processedGroups.has(field.repeatableGroup)) return;
    processedGroups.add(field.repeatableGroup);

    const groupFields = fields.filter(
      (candidateField) => candidateField.repeatableGroup === field.repeatableGroup,
    );
    const blockCount = groupFields.reduce((maxBlocks, groupField) => {
      const fieldValues = normalizeRepeatableValues(record[groupField.id]);
      return Math.max(maxBlocks, fieldValues.length);
    }, 0);

    sections.push({
      type: "group",
      groupKey: field.repeatableGroup,
      fields: groupFields,
      blocks: Array.from({ length: blockCount }, (_, index) => ({
        index: index + 1,
        entries: groupFields.map((groupField) => ({
          field: groupField,
          value: normalizeRepeatableValues(record[groupField.id])[index] ?? "",
        })),
      })),
    });
  });

  return sections;
};

export const extractInspectionResult = (
  dynamicFields: Record<string, unknown>,
  fields: ContractFieldDefinition[],
): string | null => {
  const resultField = fields.find((field) => field.isResultField);
  if (!resultField) return null;
  if (resultField.type === "image") return null;

  const rawValue = dynamicFields[resultField.id];
  if (typeof rawValue !== "string") return null;

  const trimmedValue = rawValue.trim();
  return trimmedValue ? trimmedValue : null;
};
