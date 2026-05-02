import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  HeightRule,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
} from "docx";
import { supabase } from "@/integrations/supabase/client";
import type {
  ContractFieldDefinition,
  InspectionFormatSection,
} from "./reportTemplates";
import {
  getInspectionImageSources,
  getInspectionFormatSections,
  getRepeatableLayout,
  getRepeatableGroupLabel,
  readInspectionFormatSnapshot,
} from "./reportTemplates";
import {
  getRichTextLines,
  getRichTextListItems,
  getRichTextParagraphs,
  getRichTextPlainText,
} from "./richText";
import type { Evidence, Inspection } from "./types";

type ExportContext = ReturnType<typeof getExportContext>;

type FieldMatcher = {
  labels: string[];
  suffixes: string[];
};

type SignaturePerson = {
  name: string;
  role: string;
};

type NormalExportBlock = {
  index: number;
  labor: string;
  position: string;
  observations: string[];
  recommendations: string[];
  images: string[];
  imageLayout?: "rows" | "grid3x3";
};

type NormalExportPayload = {
  contractName: string;
  reportTitle: string;
  recipient: SignaturePerson;
  sender: SignaturePerson;
  subject: string;
  memoDate: string;
  introParagraphs: string[];
  blocks: NormalExportBlock[];
  finalItems: string[];
  signatures: {
    elaboratedBy: SignaturePerson;
    reviewedBy: SignaturePerson;
    approvedBy: SignaturePerson;
  };
};

type CompletoExportBlock = {
  index: number;
  area: string;
  responsible: string;
  harnessLine: string;
  productionDate: string;
  observations: string;
  images: string[];
  imageLayout?: "rows" | "grid3x3";
};

type CompletoExportPayload = {
  contractName: string;
  reportTitle: string;
  recipient: SignaturePerson;
  sender: SignaturePerson;
  subject: string;
  memoDate: string;
  introParagraphs: string[];
  blocks: CompletoExportBlock[];
  signatures: {
    elaboratedBy: SignaturePerson;
    reviewedBy: SignaturePerson;
    approvedBy: SignaturePerson;
  };
};

type LoadedImageAsset = {
  buffer: ArrayBuffer;
  dataUrl: string;
  width: number;
  height: number;
  type: "png" | "jpg";
};

type PdfCursor = {
  y: number;
};

type PdfPhotoSlot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const PAGE_MARGIN = 44;
const PHOTO_PAGE_CAPACITY = 6;
const PHOTO_PAGE_CAPACITY_COMPLETO = 9;
const PDF_PREPARED_IMAGE_SCALE = 3;
const SIGNATURE_TABLE_HEADERS = ["ELABORADO POR:", "REVISADO POR:", "APROBADO POR:"];
const EMPTY_SIGNATURE: SignaturePerson = { name: "", role: "" };
const CORNER_LOGO_CANDIDATES = [
  "/report-assets/logo.png",
  "/report-assets/logo-esquina.png",
  "/report-assets/logo-esquina.jpg",
  "/report-assets/logo-esquina.jpeg",
  "/report-assets/corner-logo.png",
  "/report-assets/corner-logo.jpg",
  "/report-assets/corner-logo.jpeg",
] as const;

let cornerLogoAssetPromise: Promise<LoadedImageAsset | null> | null = null;

const NORMAL_FIELD_MATCHERS: Record<string, FieldMatcher> = {
  initialDescription: {
    labels: ["descripcion inicial"],
    suffixes: ["-initial-description"],
  },
  labor: {
    labels: ["labor"],
    suffixes: ["-labor"],
  },
  position: {
    labels: ["puesto"],
    suffixes: ["-position"],
  },
  observations: {
    labels: ["observaciones"],
    suffixes: ["-observations"],
  },
  recommendations: {
    labels: ["recomendaciones"],
    suffixes: ["-recommendations"],
  },
  images: {
    labels: ["imagenes", "evidencias", "fotos"],
    suffixes: ["-images"],
  },
  finalConclusions: {
    labels: ["conclusiones y recomendaciones"],
    suffixes: ["-final-conclusions"],
  },
  elaboratedBy: {
    labels: ["elaborado por"],
    suffixes: ["-elaborated-by"],
  },
  reviewedBy: {
    labels: ["revisado por"],
    suffixes: ["-reviewed-by"],
  },
  approvedBy: {
    labels: ["aprobado por"],
    suffixes: ["-approved-by"],
  },
};

const COMPLETO_FIELD_MATCHERS: Record<string, FieldMatcher> = {
  initialDescription: {
    labels: ["descripcion inicial"],
    suffixes: ["-initial-description"],
  },
  area: {
    labels: ["area"],
    suffixes: ["-area"],
  },
  responsible: {
    labels: ["responsable"],
    suffixes: ["-responsable"],
  },
  harnessLine: {
    labels: ["serie de arnes", "linea vida"],
    suffixes: ["-harness-line"],
  },
  productionDate: {
    labels: ["fecha de produccion"],
    suffixes: ["-production-date"],
  },
  observations: {
    labels: ["observaciones"],
    suffixes: ["-observations"],
  },
  images: {
    labels: ["imagenes", "evidencias", "fotos"],
    suffixes: ["-images"],
  },
  elaboratedBy: {
    labels: ["elaborado por"],
    suffixes: ["-elaborated-by"],
  },
  reviewedBy: {
    labels: ["revisado por"],
    suffixes: ["-reviewed-by"],
  },
  approvedBy: {
    labels: ["aprobado por"],
    suffixes: ["-approved-by"],
  },
};

const getEvidenceImageSource = (evidence: Evidence) =>
  evidence.image_url || evidence.image_data || "";

const getEvidenceLabel = (evidence: Evidence) => {
  if (!evidence.field_id) return "Imagen";
  if (typeof evidence.block_index === "number") {
    return `${evidence.field_id} - bloque ${evidence.block_index + 1}`;
  }

  return evidence.field_id;
};

const normalizeComparisonText = (value: string | null | undefined) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizeTextValue = (value: unknown) => getRichTextPlainText(value).trim();

const splitTextLines = (value: unknown) => getRichTextLines(value);
const splitParagraphs = (value: unknown) => getRichTextParagraphs(value);
const splitListItems = (value: unknown) => getRichTextListItems(value);
const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const fieldMatches = (field: ContractFieldDefinition, matcher: FieldMatcher) => {
  const normalizedLabel = normalizeComparisonText(field.label);

  return (
    matcher.labels.some((label) => normalizeComparisonText(label) === normalizedLabel) ||
    matcher.suffixes.some((suffix) => field.id.endsWith(suffix))
  );
};

const findSingleFieldValue = (
  sections: InspectionFormatSection[],
  matcher: FieldMatcher,
) => {
  for (const section of sections) {
    if (section.type === "field" && fieldMatches(section.field, matcher)) {
      return normalizeTextValue(section.value);
    }
  }

  return "";
};

const findSingleFieldRawValue = (
  sections: InspectionFormatSection[],
  matcher: FieldMatcher,
) => {
  for (const section of sections) {
    if (section.type === "field" && fieldMatches(section.field, matcher)) {
      return section.value;
    }
  }

  return "";
};

const findBlockTextValue = (
  block: Extract<InspectionFormatSection, { type: "group" }>["blocks"][number],
  matcher: FieldMatcher,
) => {
  const entry = block.entries.find(({ field }) => fieldMatches(field, matcher));
  return normalizeTextValue(entry?.value);
};

const findBlockBulletValues = (
  block: Extract<InspectionFormatSection, { type: "group" }>["blocks"][number],
  matcher: FieldMatcher,
) => {
  const entry = block.entries.find(({ field }) => fieldMatches(field, matcher));
  return splitListItems(entry?.value);
};

const findBlockImages = (
  block: Extract<InspectionFormatSection, { type: "group" }>["blocks"][number],
) => {
  const entry =
    block.entries.find(
      ({ field }) =>
        field.type === "image" &&
        (fieldMatches(field, NORMAL_FIELD_MATCHERS.images) || field.type === "image"),
    ) ?? block.entries.find(({ field }) => field.type === "image");

  return entry ? getInspectionImageSources(entry.value) : [];
};

const findBlockImageLayout = (
  block: Extract<InspectionFormatSection, { type: "group" }>["blocks"][number],
): "rows" | "grid3x3" | undefined => {
  const entry =
    block.entries.find(
      ({ field }) =>
        field.type === "image" &&
        (fieldMatches(field, NORMAL_FIELD_MATCHERS.images) || field.type === "image"),
    ) ?? block.entries.find(({ field }) => field.type === "image");

  return entry?.field.imageLayout;
};

const getTableGroupFields = (fields: ContractFieldDefinition[]) => {
  const nonImageFields = fields.filter((field) => field.type !== "image");
  const locationField =
    nonImageFields.find((field) => normalizeComparisonText(field.label).includes("ubic")) ??
    nonImageFields[0] ??
    fields[0];

  return {
    locationField,
    statusFields: fields.filter((field) => field.id !== locationField?.id),
  };
};

const findBlockEntryValue = (
  block: Extract<InspectionFormatSection, { type: "group" }>["blocks"][number],
  fieldId: string | undefined,
) => block.entries.find(({ field }) => field.id === fieldId)?.value;

const parsePerson = (
  name: string | null | undefined,
  role: string | null | undefined,
  combinedFallback: string | null | undefined,
): SignaturePerson => {
  const normalizedName = normalizeTextValue(name);
  const normalizedRole = normalizeTextValue(role);

  if (normalizedName || normalizedRole) {
    return {
      name: normalizedName,
      role: normalizedRole,
    };
  }

  const lines = splitTextLines(combinedFallback);

  return {
    name: lines[0] ?? "",
    role: lines.slice(1).join(" "),
  };
};

const parseSignatureValue = (
  value: string | null | undefined,
  fallback: SignaturePerson = EMPTY_SIGNATURE,
): SignaturePerson => {
  const lines = splitTextLines(value);

  if (lines.length === 0) {
    return {
      name: fallback.name,
      role: fallback.role,
    };
  }

  if (lines.length === 1) {
    return {
      name: lines[0],
      role: fallback.role,
    };
  }

  return {
    name: lines[0],
    role: lines.slice(1).join(" "),
  };
};

const resolveElaboratedBySignature = ({
  rawValue,
  userFullName,
  sender,
}: {
  rawValue: string | null | undefined;
  userFullName: string;
  sender: SignaturePerson;
}): SignaturePerson => {
  const manualSignature = parseSignatureValue(rawValue);

  return {
    name: userFullName || sender.name || manualSignature.name,
    role: manualSignature.role || sender.role,
  };
};

const getImageType = (url: string): "png" | "jpg" => {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.startsWith("data:image/png")) return "png";
  if (lowerUrl.startsWith("data:image/jpeg") || lowerUrl.startsWith("data:image/jpg")) return "jpg";
  if (lowerUrl.includes(".png")) return "png";
  return "jpg";
};

const fetchAsArrayBuffer = async (url: string): Promise<ArrayBuffer | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    return await response.arrayBuffer();
  } catch {
    return null;
  }
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
};

const dataUrlToArrayBuffer = (dataUrl: string): ArrayBuffer | null => {
  try {
    const [metadata, encoded] = dataUrl.split(",");
    if (!metadata || !encoded) return null;

    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes.buffer;
  } catch {
    return null;
  }
};

const loadImageDimensions = async (source: string) =>
  new Promise<{ width: number; height: number } | null>((resolve) => {
    const image = new Image();

    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    };

    image.onerror = () => resolve(null);
    image.src = source;
  });

const loadImageElement = async (source: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });

const loadImageAsset = async (imageSource: string): Promise<LoadedImageAsset | null> => {
  if (!imageSource) return null;

  const type = getImageType(imageSource);

  if (imageSource.startsWith("data:image/")) {
    const buffer = dataUrlToArrayBuffer(imageSource);
    const dimensions = await loadImageDimensions(imageSource);

    if (!buffer || !dimensions) return null;

    return {
      buffer,
      dataUrl: imageSource,
      width: dimensions.width,
      height: dimensions.height,
      type,
    };
  }

  const buffer = await fetchAsArrayBuffer(imageSource);
  if (!buffer) return null;

  const mime = type === "png" ? "png" : "jpeg";
  const dataUrl = `data:image/${mime};base64,${arrayBufferToBase64(buffer)}`;
  const dimensions = await loadImageDimensions(dataUrl);
  if (!dimensions) return null;

  return {
    buffer,
    dataUrl,
    width: dimensions.width,
    height: dimensions.height,
    type,
  };
};

const loadCornerLogoAsset = () => {
  if (!cornerLogoAssetPromise) {
    cornerLogoAssetPromise = (async () => {
      for (const candidate of CORNER_LOGO_CANDIDATES) {
        const asset = await loadImageAsset(candidate);
        if (asset) return asset;
      }

      return null;
    })();
  }

  return cornerLogoAssetPromise;
};

const detectImageContentBounds = (image: HTMLImageElement) => {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const longestSide = Math.max(sourceWidth, sourceHeight);
  const scanScale = longestSide > 900 ? 900 / longestSide : 1;
  const scanWidth = Math.max(1, Math.round(sourceWidth * scanScale));
  const scanHeight = Math.max(1, Math.round(sourceHeight * scanScale));
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  }

  canvas.width = scanWidth;
  canvas.height = scanHeight;
  context.drawImage(image, 0, 0, scanWidth, scanHeight);

  const { data } = context.getImageData(0, 0, scanWidth, scanHeight);
  let minX = scanWidth;
  let minY = scanHeight;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < scanHeight; y += 1) {
    for (let x = 0; x < scanWidth; x += 1) {
      const index = (y * scanWidth + x) * 4;
      const alpha = data[index + 3];
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const isVisible = alpha > 12;
      const isNearWhite = red > 245 && green > 245 && blue > 245;

      if (isVisible && !isNearWhite) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  }

  const padding = 10;
  const cropX = Math.max(0, Math.floor((minX - padding) / scanScale));
  const cropY = Math.max(0, Math.floor((minY - padding) / scanScale));
  const cropRight = Math.min(sourceWidth, Math.ceil((maxX + padding) / scanScale));
  const cropBottom = Math.min(sourceHeight, Math.ceil((maxY + padding) / scanScale));

  return {
    x: cropX,
    y: cropY,
    width: Math.max(1, cropRight - cropX),
    height: Math.max(1, cropBottom - cropY),
  };
};

const prepareImageAssetForFrame = async (
  asset: LoadedImageAsset,
  targetWidth: number,
  targetHeight: number,
  options: {
    fitMode?: "contain" | "cover";
    trimWhitespace?: boolean;
    outputScale?: number;
  } = {},
): Promise<LoadedImageAsset> => {
  const image = await loadImageElement(asset.dataUrl);
  if (!image) return asset;

  const fitMode = options.fitMode ?? "contain";
  const trimWhitespace = options.trimWhitespace ?? false;
  const outputScale = Math.max(1, options.outputScale ?? 1);
  const sourceBounds = trimWhitespace
    ? detectImageContentBounds(image)
    : {
        x: 0,
        y: 0,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      };
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) return asset;

  const outputWidth = Math.max(1, Math.round(targetWidth * outputScale));
  const outputHeight = Math.max(1, Math.round(targetHeight * outputScale));

  canvas.width = outputWidth;
  canvas.height = outputHeight;
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, outputWidth, outputHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const ratio =
    fitMode === "cover"
      ? Math.max(outputWidth / sourceBounds.width, outputHeight / sourceBounds.height)
      : Math.min(outputWidth / sourceBounds.width, outputHeight / sourceBounds.height);
  const drawWidth = Math.max(1, Math.round(sourceBounds.width * ratio));
  const drawHeight = Math.max(1, Math.round(sourceBounds.height * ratio));
  const drawX = Math.round((outputWidth - drawWidth) / 2);
  const drawY = Math.round((outputHeight - drawHeight) / 2);

  context.drawImage(
    image,
    sourceBounds.x,
    sourceBounds.y,
    sourceBounds.width,
    sourceBounds.height,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  );

  const mime = asset.type === "png" ? "image/png" : "image/jpeg";
  const dataUrl = canvas.toDataURL(mime, asset.type === "png" ? undefined : 0.92);
  const buffer = dataUrlToArrayBuffer(dataUrl);

  if (!buffer) return asset;

  return {
    buffer,
    dataUrl,
    width: outputWidth,
    height: outputHeight,
    type: asset.type,
  };
};

const fitInsideBox = (
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
) => {
  if (!width || !height) {
    return {
      width: maxWidth,
      height: maxHeight,
    };
  }

  const ratio = Math.min(maxWidth / width, maxHeight / height);

  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
};

const formatMemoDate = (value: string | null | undefined) => {
  const normalizedValue = normalizeTextValue(value);
  if (!normalizedValue) return "-";

  try {
    return format(parseISO(normalizedValue), "d 'de' MMMM 'del' yyyy", { locale: es });
  } catch {
    return normalizedValue;
  }
};

const buildFallbackIntro = (inspection: Inspection, subject: string) => {
  const dateText = formatMemoDate(inspection.inspection_date);
  const topic = subject || inspection.personnel_in_charge || "la inspeccion realizada";

  return `Mediante el presente se informa el reporte correspondiente a ${topic} realizado el ${dateText}.`;
};

const fetchInspectionUserName = async (inspection: Inspection) => {
  try {
    const { data } = await supabase
      .from("users_profile")
      .select("full_name")
      .eq("id", inspection.user_id)
      .maybeSingle();

    return normalizeTextValue(data?.full_name);
  } catch {
    return "";
  }
};

const getExportContext = (inspection: Inspection) => {
  const snapshot = readInspectionFormatSnapshot(
    inspection.dynamic_fields,
    inspection.contract_type,
  );
  const contractName = snapshot.templateName || inspection.contract_type || "-";
  const formatSections = getInspectionFormatSections(inspection.dynamic_fields, snapshot.fields);
  const fieldValueText = (type: string, value: unknown) => {
    if (type === "image") {
      const imageCount = getInspectionImageSources(value).length;
      return imageCount > 0 ? `${imageCount} imagen(es) adjuntas` : "Sin imagen";
    }

    const normalizedValue = normalizeTextValue(value);
    return normalizedValue || "-";
  };

  return {
    contractName,
    formatName: snapshot.formatName,
    formatDescription: snapshot.formatDescription,
    formatSections,
    fields: snapshot.fields,
    fieldValueText,
  };
};

const shouldUseNormalLayout = (context: ExportContext) => {
  const formatName = normalizeComparisonText(context.formatName);
  if (formatName === "normal") return true;

  const hasLaborField = context.fields.some((field) => fieldMatches(field, NORMAL_FIELD_MATCHERS.labor));
  const hasObservationField = context.fields.some((field) =>
    fieldMatches(field, NORMAL_FIELD_MATCHERS.observations),
  );

  return hasLaborField && hasObservationField;
};

const shouldUseCompletoLayout = (context: ExportContext) => {
  const formatName = normalizeComparisonText(context.formatName);
  if (formatName === "completo") return true;

  const hasAreaField = context.fields.some((field) => fieldMatches(field, COMPLETO_FIELD_MATCHERS.area));
  const hasResponsibleField = context.fields.some((field) =>
    fieldMatches(field, COMPLETO_FIELD_MATCHERS.responsible),
  );

  return hasAreaField && hasResponsibleField;
};

const hasTableLayoutSections = (context: ExportContext) =>
  context.formatSections.some(
    (section) => section.type === "group" && getRepeatableLayout(section.fields) === "table",
  );

const buildNormalExportPayload = async (
  inspection: Inspection,
  context: ExportContext,
): Promise<NormalExportPayload> => {
  const reportTitle = normalizeTextValue(inspection.title) || normalizeTextValue(inspection.area) || "Informe";
  const recipient = parsePerson(
    inspection.recipient_name,
    inspection.recipient_title,
    inspection.location,
  );
  const sender = parsePerson(
    inspection.sender_name,
    inspection.sender_title,
    inspection.specific_site,
  );
  const subject = normalizeTextValue(inspection.subject) || normalizeTextValue(inspection.personnel_in_charge);
  const initialDescription = findSingleFieldRawValue(
    context.formatSections,
    NORMAL_FIELD_MATCHERS.initialDescription,
  );
  const finalConclusions = findSingleFieldRawValue(
    context.formatSections,
    NORMAL_FIELD_MATCHERS.finalConclusions,
  );
  const rawElaboratedBy = findSingleFieldValue(
    context.formatSections,
    NORMAL_FIELD_MATCHERS.elaboratedBy,
  );
  const rawReviewedBy = findSingleFieldValue(
    context.formatSections,
    NORMAL_FIELD_MATCHERS.reviewedBy,
  );
  const rawApprovedBy = findSingleFieldValue(
    context.formatSections,
    NORMAL_FIELD_MATCHERS.approvedBy,
  );
  const userFullName = await fetchInspectionUserName(inspection);
  const elaboratedBy = resolveElaboratedBySignature({
    rawValue: rawElaboratedBy,
    userFullName,
    sender,
  });

  const blocks = context.formatSections.flatMap((section) => {
    if (section.type !== "group") return [];
    if (getRepeatableLayout(section.fields) === "table") return [];

    return section.blocks.map<NormalExportBlock>((block) => ({
      index: block.index,
      labor: findBlockTextValue(block, NORMAL_FIELD_MATCHERS.labor),
      position: findBlockTextValue(block, NORMAL_FIELD_MATCHERS.position),
      observations: findBlockBulletValues(block, NORMAL_FIELD_MATCHERS.observations),
      recommendations: findBlockBulletValues(block, NORMAL_FIELD_MATCHERS.recommendations),
      images: findBlockImages(block),
      imageLayout: findBlockImageLayout(block),
    }));
  });

  return {
    contractName: context.contractName,
    reportTitle,
    recipient,
    sender,
    subject: subject || "-",
    memoDate: formatMemoDate(inspection.inspection_date),
    introParagraphs:
      getRichTextParagraphs(initialDescription).length > 0
        ? getRichTextParagraphs(initialDescription)
        : [buildFallbackIntro(inspection, subject)],
    blocks,
    finalItems: getRichTextListItems(finalConclusions),
    signatures: {
      elaboratedBy,
      reviewedBy: parseSignatureValue(rawReviewedBy),
      approvedBy: parseSignatureValue(rawApprovedBy),
    },
  };
};

const buildCompletoExportPayload = async (
  inspection: Inspection,
  context: ExportContext,
): Promise<CompletoExportPayload> => {
  const reportTitle = normalizeTextValue(inspection.title) || normalizeTextValue(inspection.area) || "Informe";
  const recipient = parsePerson(
    inspection.recipient_name,
    inspection.recipient_title,
    inspection.location,
  );
  const sender = parsePerson(
    inspection.sender_name,
    inspection.sender_title,
    inspection.specific_site,
  );
  const subject = normalizeTextValue(inspection.subject) || normalizeTextValue(inspection.personnel_in_charge);
  const initialDescription = findSingleFieldRawValue(
    context.formatSections,
    COMPLETO_FIELD_MATCHERS.initialDescription,
  );
  const rawElaboratedBy = findSingleFieldValue(
    context.formatSections,
    COMPLETO_FIELD_MATCHERS.elaboratedBy,
  );
  const rawReviewedBy = findSingleFieldValue(
    context.formatSections,
    COMPLETO_FIELD_MATCHERS.reviewedBy,
  );
  const rawApprovedBy = findSingleFieldValue(
    context.formatSections,
    COMPLETO_FIELD_MATCHERS.approvedBy,
  );
  const userFullName = await fetchInspectionUserName(inspection);
  const elaboratedBy = resolveElaboratedBySignature({
    rawValue: rawElaboratedBy,
    userFullName,
    sender,
  });

  const blocks = context.formatSections.flatMap((section) => {
    if (section.type !== "group") return [];
    if (getRepeatableLayout(section.fields) === "table") return [];

    return section.blocks.map<CompletoExportBlock>((block) => ({
      index: block.index,
      area: findBlockTextValue(block, COMPLETO_FIELD_MATCHERS.area),
      responsible: findBlockTextValue(block, COMPLETO_FIELD_MATCHERS.responsible),
      harnessLine: findBlockTextValue(block, COMPLETO_FIELD_MATCHERS.harnessLine),
      productionDate: findBlockTextValue(block, COMPLETO_FIELD_MATCHERS.productionDate),
      observations: findBlockTextValue(block, COMPLETO_FIELD_MATCHERS.observations),
      images: findBlockImages(block),
      imageLayout: findBlockImageLayout(block),
    }));
  });

  return {
    contractName: context.contractName,
    reportTitle,
    recipient,
    sender,
    subject: subject || "-",
    memoDate: formatMemoDate(inspection.inspection_date),
    introParagraphs:
      getRichTextParagraphs(initialDescription).length > 0
        ? getRichTextParagraphs(initialDescription)
        : [buildFallbackIntro(inspection, subject)],
    blocks,
    signatures: {
      elaboratedBy,
      reviewedBy: parseSignatureValue(rawReviewedBy),
      approvedBy: parseSignatureValue(rawApprovedBy),
    },
  };
};

const estimateBulletListHeightPdf = (
  doc: jsPDF,
  items: string[],
  width: number,
  lineHeight = 14,
) =>
  items.reduce((totalHeight, item) => {
    const lines = doc.splitTextToSize(item, Math.max(60, width - 14));
    return totalHeight + lines.length * lineHeight + 4;
  }, 0);

const ensurePdfSpace = (
  doc: jsPDF,
  cursor: PdfCursor,
  requiredHeight: number,
  margin = PAGE_MARGIN,
) => {
  const pageHeight = doc.internal.pageSize.getHeight();

  if (cursor.y + requiredHeight > pageHeight - margin) {
    doc.addPage();
    cursor.y = margin;
  }
};

const drawBulletListPdf = (
  doc: jsPDF,
  cursor: PdfCursor,
  items: string[],
  {
    x,
    width,
    margin = PAGE_MARGIN,
    lineHeight = 14,
  }: {
    x: number;
    width: number;
    margin?: number;
    lineHeight?: number;
  },
) => {
  const printableWidth = Math.max(80, width - 14);

  for (const item of items) {
    const lines = doc.splitTextToSize(item, printableWidth);
    ensurePdfSpace(doc, cursor, lines.length * lineHeight + 6, margin);
    doc.circle(x + 4, cursor.y - 4, 1.5, "F");
    doc.text(lines, x + 14, cursor.y);
    cursor.y += lines.length * lineHeight + 4;
  }
};

const drawLoadedImagePdf = (
  doc: jsPDF,
  asset: LoadedImageAsset,
  x: number,
  y: number,
  width: number,
  height: number,
  drawBorder = true,
) => {
  const dimensions = fitInsideBox(asset.width, asset.height, width, height);
  const offsetX = x + (width - dimensions.width) / 2;
  const offsetY = y + (height - dimensions.height) / 2;
  const formatName = asset.type === "png" ? "PNG" : "JPEG";

  if (drawBorder) {
    doc.setDrawColor(120, 120, 120);
    doc.rect(x, y, width, height);
  }

  try {
    doc.addImage(
      asset.dataUrl,
      formatName,
      offsetX,
      offsetY,
      dimensions.width,
      dimensions.height,
    );
  } catch {
    // Ignore decode issues on export.
  }
};

const drawPdfAccentHeading = (
  doc: jsPDF,
  cursor: PdfCursor,
  text: string,
  x: number,
) => {
  const headingText = text.toUpperCase();

  ensurePdfSpace(doc, cursor, 26);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(0, 112, 192);
  doc.text(headingText, x, cursor.y);
  doc.setDrawColor(0, 112, 192);
  doc.line(x, cursor.y + 3, x + doc.getTextWidth(headingText), cursor.y + 3);
  doc.setTextColor(0, 0, 0);
  cursor.y += 24;
};

const getPhotoGallerySpec = (count: number) => {
  if (count <= 1) {
    return {
      columns: 1,
      boxWidth: 500,
      boxHeight: 375,
      gapX: 0,
      gapY: 0,
    };
  }

  if (count === 2) {
    return {
      columns: 2,
      boxWidth: 220,
      boxHeight: 280,
      gapX: 24,
      gapY: 0,
    };
  }

  if (count <= 4) {
    return {
      columns: 2,
      boxWidth: 220,
      boxHeight: 200,
      gapX: 24,
      gapY: 25,
    };
  }

  return {
    columns: 2,
    boxWidth: 220,
    boxHeight: 175,
    gapX: 24,
    gapY: 20,
  };
};

const getPhotoGallerySpecCompleto = (pageWidth: number) => {
  const columns = 3;
  const gapX = 12;
  const gapY = 12;
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const boxWidth = Math.floor((contentWidth - gapX * (columns - 1)) / columns);

  return {
    columns,
    boxWidth,
    boxHeight: boxWidth,
    gapX,
    gapY,
    contentWidth,
  };
};

const buildPdfPhotoGallerySlots = (pageWidth: number, imageCount: number) => {
  const spec = getPhotoGallerySpec(imageCount);
  const rows = Math.ceil(imageCount / spec.columns);
  const rowCounts = Array.from({ length: rows }, (_, rowIndex) => {
    const remaining = imageCount - rowIndex * spec.columns;
    return Math.min(spec.columns, remaining);
  });
  const totalHeight = rows * spec.boxHeight + Math.max(0, rows - 1) * spec.gapY;
  const galleryTop = 118;
  const galleryHeight = 610;
  const startY = galleryTop + Math.max(0, (galleryHeight - totalHeight) / 2);
  const slots: Array<{ x: number; y: number; width: number; height: number }> = [];
  let currentY = startY;

  rowCounts.forEach((rowCount) => {
    const rowWidth = rowCount * spec.boxWidth + Math.max(0, rowCount - 1) * spec.gapX;
    const startX = (pageWidth - rowWidth) / 2;

    for (let columnIndex = 0; columnIndex < rowCount; columnIndex += 1) {
      slots.push({
        x: startX + columnIndex * (spec.boxWidth + spec.gapX),
        y: currentY,
        width: spec.boxWidth,
        height: spec.boxHeight,
      });
    }

    currentY += spec.boxHeight + spec.gapY;
  });

  return slots;
};

const buildPdfPhotoGallerySlotsCompleto = (
  pageWidth: number,
  imageCount: number,
  options: {
    topY?: number;
    availableHeight?: number;
  } = {},
) => {
  const spec = getPhotoGallerySpecCompleto(pageWidth);
  const rows = Math.ceil(imageCount / spec.columns);
  const rowCounts = Array.from({ length: rows }, (_, rowIndex) => {
    const remaining = imageCount - rowIndex * spec.columns;
    return Math.min(spec.columns, remaining);
  });
  const totalHeight = rows * spec.boxHeight + Math.max(0, rows - 1) * spec.gapY;
  const topY = options.topY ?? 110;
  const availableHeight = options.availableHeight;
  const startY =
    typeof availableHeight === "number"
      ? topY + Math.max(0, (availableHeight - totalHeight) / 2)
      : topY;
  const slots: PdfPhotoSlot[] = [];
  let currentY = startY;

  rowCounts.forEach((rowCount) => {
    const rowWidth = rowCount * spec.boxWidth + Math.max(0, rowCount - 1) * spec.gapX;
    const startX = PAGE_MARGIN + (spec.contentWidth - rowWidth) / 2;

    for (let columnIndex = 0; columnIndex < rowCount; columnIndex += 1) {
      slots.push({
        x: startX + columnIndex * (spec.boxWidth + spec.gapX),
        y: currentY,
        width: spec.boxWidth,
        height: spec.boxHeight,
      });
    }

    currentY += spec.boxHeight + spec.gapY;
  });

  return { slots, totalHeight };
};

const addPdfBadge = (
  doc: jsPDF,
  text: string,
  cornerLogoAsset: LoadedImageAsset | null = null,
) => {
  if (cornerLogoAsset) {
    const dimensions = fitInsideBox(cornerLogoAsset.width, cornerLogoAsset.height, 120, 52);
    const formatName = cornerLogoAsset.type === "png" ? "PNG" : "JPEG";

    try {
      doc.addImage(
        cornerLogoAsset.dataUrl,
        formatName,
        PAGE_MARGIN,
        34,
        dimensions.width,
        dimensions.height,
      );
      return;
    } catch {
      // Ignore decode issues on export and keep fallback below.
    }
  }

  const badgeText = normalizeTextValue(text) || "InspectPro";
  const badgeLines = doc.splitTextToSize(badgeText, 84);

  doc.setFillColor(144, 179, 124);
  doc.setDrawColor(202, 221, 180);
  doc.roundedRect(PAGE_MARGIN, 42, 110, 48, 16, 16, "FD");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(badgeLines, PAGE_MARGIN + 55, 64, { align: "center" });
};

const addNormalPdfHeader = (
  doc: jsPDF,
  payload: NormalExportPayload,
  cursor: PdfCursor,
  cornerLogoAsset: LoadedImageAsset | null,
) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const valueX = PAGE_MARGIN + 108;

  addPdfBadge(doc, payload.contractName, cornerLogoAsset);

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(payload.reportTitle, pageWidth / 2 + 18, 70, { align: "center", maxWidth: 280 });
  doc.line(pageWidth / 2 - 110, 76, pageWidth / 2 + 146, 76);

  cursor.y = 118;

  const drawMemoPersonRow = (label: string, person: SignaturePerson) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(label, PAGE_MARGIN + 18, cursor.y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`: ${person.name || "-"}`, valueX, cursor.y);
    cursor.y += 18;

    if (person.role) {
      doc.setFont("helvetica", "bold");
      doc.text(person.role, valueX + 8, cursor.y);
      cursor.y += 22;
    } else {
      cursor.y += 12;
    }
  };

  const drawMemoTextRow = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(label, PAGE_MARGIN + 18, cursor.y);

    doc.setFont("helvetica", "normal");
    doc.text(`: ${value || "-"}`, valueX, cursor.y);
    cursor.y += 22;
  };

  drawMemoPersonRow("PARA", payload.recipient);
  drawMemoPersonRow("DE", payload.sender);
  drawMemoTextRow("ASUNTO", payload.subject);
  drawMemoTextRow("Fecha", payload.memoDate);

  doc.line(PAGE_MARGIN + 18, cursor.y - 8, pageWidth - PAGE_MARGIN, cursor.y - 8);
  cursor.y += 18;
};

const addNormalPdfIntro = (
  doc: jsPDF,
  payload: NormalExportPayload,
  cursor: PdfCursor,
) => {
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFont("helvetica", "italic");
  doc.setFontSize(12);
  doc.setTextColor(34, 34, 34);

  for (const paragraph of payload.introParagraphs) {
    const lines = doc.splitTextToSize(paragraph, pageWidth - PAGE_MARGIN * 2 - 18);
    ensurePdfSpace(doc, cursor, lines.length * 16 + 10);
    doc.text(lines, PAGE_MARGIN + 18, cursor.y);
    cursor.y += lines.length * 16 + 10;
  }

  cursor.y += 10;
};

const addNormalPdfRecommendations = async (
  doc: jsPDF,
  cursor: PdfCursor,
  block: NormalExportBlock,
  imageAssets: LoadedImageAsset[],
) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const heroImage = imageAssets[0]
    ? await prepareImageAssetForFrame(imageAssets[0], 220, 260, {
        fitMode: "contain",
        trimWhitespace: true,
        outputScale: PDF_PREPARED_IMAGE_SCALE,
      })
    : null;

  drawPdfAccentHeading(doc, cursor, "RECOMENDACIONES:", PAGE_MARGIN + 8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);

  if (block.recommendations.length === 0) {
    const fallbackText = "Sin recomendaciones registradas.";
    ensurePdfSpace(doc, cursor, 18);
    doc.text(fallbackText, PAGE_MARGIN + 14, cursor.y);
    cursor.y += 20;

    if (heroImage) {
      ensurePdfSpace(doc, cursor, 240);
      drawLoadedImagePdf(
        doc,
        heroImage,
        pageWidth - PAGE_MARGIN - 220,
        cursor.y,
        220,
        260,
        false,
      );
      cursor.y += 276;
      return true;
    }

    return false;
  }

  if (heroImage) {
    const imageBox = {
      x: pageWidth - PAGE_MARGIN - 220,
      y: cursor.y,
      width: 220,
      height: 260,
    };
    const availableWidth = pageWidth - PAGE_MARGIN * 2 - imageBox.width - 18;
    const estimatedHeight = estimateBulletListHeightPdf(doc, block.recommendations, availableWidth);

    if (estimatedHeight <= imageBox.height && cursor.y + imageBox.height < pageHeight - PAGE_MARGIN) {
      const initialY = cursor.y;
      drawBulletListPdf(doc, cursor, block.recommendations, {
        x: PAGE_MARGIN + 8,
        width: availableWidth,
      });
      drawLoadedImagePdf(
        doc,
        heroImage,
        imageBox.x,
        imageBox.y,
        220,
        260,
        false,
      );
      cursor.y = Math.max(cursor.y, initialY + imageBox.height + 14);
      return true;
    }
  }

  drawBulletListPdf(doc, cursor, block.recommendations, {
    x: PAGE_MARGIN + 8,
    width: pageWidth - PAGE_MARGIN * 2 - 8,
  });

  if (heroImage) {
    ensurePdfSpace(doc, cursor, 240);
    drawLoadedImagePdf(
      doc,
      heroImage,
      pageWidth - PAGE_MARGIN - 220,
      cursor.y,
      220,
      260,
      false,
    );
    cursor.y += 276;
  }

  return Boolean(heroImage);
};

const addNormalPdfPhotoPages = async (
  doc: jsPDF,
  block: NormalExportBlock,
  imageAssets: LoadedImageAsset[],
  contractName: string,
  cornerLogoAsset: LoadedImageAsset | null,
) => {
  if (imageAssets.length === 0) return;

  const pageWidth = doc.internal.pageSize.getWidth();
  const isGrid3x3 = block.imageLayout === "grid3x3";
  const capacity = isGrid3x3 ? PHOTO_PAGE_CAPACITY_COMPLETO : PHOTO_PAGE_CAPACITY;

  for (const imageChunk of chunkArray(imageAssets, capacity)) {
    doc.addPage();
    addPdfBadge(doc, contractName, cornerLogoAsset);
    
    const slots = isGrid3x3 
      ? buildPdfPhotoGallerySlotsCompleto(pageWidth, imageChunk.length).slots
      : buildPdfPhotoGallerySlots(pageWidth, imageChunk.length);
    
    const preparedAssets = await Promise.all(
      imageChunk.map((asset, index) =>
        prepareImageAssetForFrame(asset, slots[index].width, slots[index].height, {
          fitMode: "contain",
          trimWhitespace: true,
          outputScale: PDF_PREPARED_IMAGE_SCALE,
        }),
      ),
    );

    preparedAssets.forEach((asset, index) => {
      const slot = slots[index];
      drawLoadedImagePdf(doc, asset, slot.x, slot.y, slot.width, slot.height, false);
    });
  }
};

const drawPdfSignatureCellContent = (
  doc: jsPDF,
  signature: SignaturePerson,
  cellX: number,
  bodyTopY: number,
  cellWidth: number,
  bodyHeight: number,
) => {
  const maxWidth = cellWidth - 18;
  const textCenter = cellX + cellWidth / 2;
  const nameLines = signature.name ? doc.splitTextToSize(signature.name, maxWidth) : [];
  const roleLines = signature.role ? doc.splitTextToSize(signature.role, maxWidth) : [];

  if (nameLines.length === 0 && roleLines.length === 0) return;

  const nameLineHeight = 14;
  const roleLineHeight = 12;
  const sectionGap = nameLines.length > 0 && roleLines.length > 0 ? 10 : 0;
  const blockHeight =
    nameLines.length * nameLineHeight + roleLines.length * roleLineHeight + sectionGap;
  const topPadding = Math.max(14, (bodyHeight - blockHeight) / 2);
  let currentY = bodyTopY + topPadding + 8;

  if (nameLines.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);

    nameLines.forEach((line) => {
      doc.text(line, textCenter, currentY, {
        align: "center",
        maxWidth,
      });
      currentY += nameLineHeight;
    });
  }

  if (roleLines.length > 0) {
    currentY += sectionGap;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    roleLines.forEach((line) => {
      doc.text(line, textCenter, currentY, {
        align: "center",
        maxWidth,
      });
      currentY += roleLineHeight;
    });
  }
};

const addNormalPdfSignatureTable = (
  doc: jsPDF,
  payload: NormalExportPayload,
  cursor: PdfCursor,
) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const headerHeight = 20;
  const bodyHeight = 110;
  const requiredHeight = headerHeight + bodyHeight + 12;

  ensurePdfSpace(doc, cursor, requiredHeight);
  const tableX = PAGE_MARGIN;
  const tableY = cursor.y + 8;
  const tableWidth = pageWidth - PAGE_MARGIN * 2;
  const columnWidth = tableWidth / 3;
  const signatures = [
    payload.signatures.elaboratedBy,
    payload.signatures.reviewedBy,
    payload.signatures.approvedBy,
  ];

  doc.rect(tableX, tableY, tableWidth, headerHeight + bodyHeight);

  for (let index = 1; index < 3; index += 1) {
    const x = tableX + index * columnWidth;
    doc.line(x, tableY, x, tableY + headerHeight + bodyHeight);
  }

  doc.line(tableX, tableY + headerHeight, tableX + tableWidth, tableY + headerHeight);

  SIGNATURE_TABLE_HEADERS.forEach((header, index) => {
    const cellX = tableX + index * columnWidth;
    const signature = signatures[index];

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(header, cellX + 6, tableY + 13);
    drawPdfSignatureCellContent(
      doc,
      signature,
      cellX,
      tableY + headerHeight,
      columnWidth,
      bodyHeight,
    );
  });

  cursor.y = tableY + headerHeight + bodyHeight + 8;
};

const addCompletoPhotoPages = async (
  doc: jsPDF,
  block: CompletoExportBlock,
  imageAssets: LoadedImageAsset[],
  contractName: string,
  cornerLogoAsset: LoadedImageAsset | null,
) => {
  if (imageAssets.length === 0) return;

  const pageWidth = doc.internal.pageSize.getWidth();
  const isGrid3x3 = block.imageLayout === "grid3x3";
  const capacity = isGrid3x3 ? PHOTO_PAGE_CAPACITY_COMPLETO : PHOTO_PAGE_CAPACITY;

  for (const imageChunk of chunkArray(imageAssets, capacity)) {
    doc.addPage();
    addPdfBadge(doc, contractName, cornerLogoAsset);
    
    const slots = isGrid3x3 
      ? buildPdfPhotoGallerySlotsCompleto(pageWidth, imageChunk.length, {
          topY: 110,
          availableHeight: 620,
        }).slots
      : buildPdfPhotoGallerySlots(pageWidth, imageChunk.length);
    
    const preparedAssets = await Promise.all(
      imageChunk.map((asset, index) =>
        prepareImageAssetForFrame(asset, slots[index].width, slots[index].height, {
          fitMode: "contain",
          trimWhitespace: true,
          outputScale: PDF_PREPARED_IMAGE_SCALE,
        }),
      ),
    );

    preparedAssets.forEach((asset, index) => {
      const slot = slots[index];
      drawLoadedImagePdf(doc, asset, slot.x, slot.y, slot.width, slot.height, false);
    });
  }
};

const addCompletoPdfSignatureTable = (
  doc: jsPDF,
  payload: CompletoExportPayload,
  cursor: PdfCursor,
) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const headerHeight = 20;
  const bodyHeight = 110;
  const requiredHeight = headerHeight + bodyHeight + 12;

  ensurePdfSpace(doc, cursor, requiredHeight);
  const tableX = PAGE_MARGIN;
  const tableY = cursor.y + 8;
  const tableWidth = pageWidth - PAGE_MARGIN * 2;
  const columnWidth = tableWidth / 3;
  const signatures = [
    payload.signatures.elaboratedBy,
    payload.signatures.reviewedBy,
    payload.signatures.approvedBy,
  ];

  doc.rect(tableX, tableY, tableWidth, headerHeight + bodyHeight);

  for (let index = 1; index < 3; index += 1) {
    const x = tableX + index * columnWidth;
    doc.line(x, tableY, x, tableY + headerHeight + bodyHeight);
  }

  doc.line(tableX, tableY + headerHeight, tableX + tableWidth, tableY + headerHeight);

  const completeHeaders = ["ELABORADO POR:", "COMITÉ SSOMA:", "REVISADO POR:", "APROBADO POR:"];
  const displayHeaders = completeHeaders
    .slice(0, 3)
    .map((header, index) => (index === 1 ? "COMITE SSOMA:" : header));

  displayHeaders.forEach((header, index) => {
    const cellX = tableX + index * columnWidth;
    const signature = signatures[index];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(header, cellX + 6, tableY + 13);
    drawPdfSignatureCellContent(
      doc,
      signature,
      cellX,
      tableY + headerHeight,
      columnWidth,
      bodyHeight,
    );
  });

  cursor.y = tableY + headerHeight + bodyHeight + 8;
};

const exportCompletoToPDF = async (
  inspection: Inspection,
  context: ExportContext,
) => {
  const payload = await buildCompletoExportPayload(inspection, context);
  const cornerLogoAsset = await loadCornerLogoAsset();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const cursor: PdfCursor = { y: PAGE_MARGIN };

  addNormalPdfHeader(doc, payload, cursor, cornerLogoAsset);
  addNormalPdfIntro(doc, payload, cursor);
  await addReportPdfTableSections(doc, cursor, context);

  for (let index = 0; index < payload.blocks.length; index += 1) {
    const block = payload.blocks[index];
    const imageAssets = (
      await Promise.all(block.images.map((imageSource) => loadImageAsset(imageSource)))
    ).filter((asset): asset is LoadedImageAsset => Boolean(asset));

    if (index > 0) {
      doc.addPage();
      cursor.y = PAGE_MARGIN + 16;
    }

    // Mostrar datos del bloque Completo
    doc.setFont("helvetica", "bolditalic");
    doc.setFontSize(14);
    doc.setTextColor(220, 38, 38);
    ensurePdfSpace(doc, cursor, 40);
    doc.text(`Area: ${block.area || "-"}`, PAGE_MARGIN + 18, cursor.y);
    cursor.y += 22;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(34, 34, 34);
    ensurePdfSpace(doc, cursor, 60);
    
    const fieldLines = [
      `Responsable: ${block.responsible || "-"}`,
      `Serie de arnés|Línea vida: ${block.harnessLine || "-"}`,
      `Fecha de Producción: ${block.productionDate || "-"}`,
    ];

    fieldLines.forEach((line) => {
      doc.text(line, PAGE_MARGIN + 18, cursor.y);
      cursor.y += 16;
    });

    cursor.y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Observaciones:", PAGE_MARGIN + 18, cursor.y);
    cursor.y += 14;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    if (block.observations) {
      const obsLines = doc.splitTextToSize(block.observations, pageWidth - PAGE_MARGIN * 2 - 36);
      obsLines.forEach((line: string) => {
        ensurePdfSpace(doc, cursor, 16);
        doc.text(line, PAGE_MARGIN + 18, cursor.y);
        cursor.y += 14;
      });
    } else {
      doc.text("Sin observaciones registradas.", PAGE_MARGIN + 18, cursor.y);
      cursor.y += 14;
    }

    cursor.y += 8;

    if (imageAssets.length > 0) {
      const isGrid3x3 = block.imageLayout === "grid3x3";
      const capacity = isGrid3x3 ? PHOTO_PAGE_CAPACITY_COMPLETO : PHOTO_PAGE_CAPACITY;
      
      for (const imageChunk of chunkArray(imageAssets, capacity)) {
        const galleryLayout = isGrid3x3
          ? buildPdfPhotoGallerySlotsCompleto(pageWidth, imageChunk.length)
          : { slots: buildPdfPhotoGallerySlots(pageWidth, imageChunk.length), totalHeight: imageChunk.length * 200 };
        
        ensurePdfSpace(doc, cursor, galleryLayout.totalHeight + 16);
        const { slots, totalHeight } = isGrid3x3
          ? buildPdfPhotoGallerySlotsCompleto(pageWidth, imageChunk.length, {
              topY: cursor.y,
            })
          : { 
              slots: buildPdfPhotoGallerySlots(pageWidth, imageChunk.length),
              totalHeight: imageChunk.length * 200
            };
        
        const preparedAssets = await Promise.all(
          imageChunk.map((asset, idx) =>
            prepareImageAssetForFrame(asset, slots[idx].width, slots[idx].height, {
              fitMode: "contain",
              trimWhitespace: true,
              outputScale: PDF_PREPARED_IMAGE_SCALE,
            }),
          ),
        );

        preparedAssets.forEach((asset, idx) => {
          const slot = slots[idx];
          drawLoadedImagePdf(doc, asset, slot.x, slot.y, slot.width, slot.height, false);
        });

        cursor.y += totalHeight + 16;
      }
    }

    // Agregar imágenes en galería según configuración
    if (block.index < 0 && imageAssets.length > 0) {
      const isGrid3x3 = block.imageLayout === "grid3x3";
      const capacity = isGrid3x3 ? PHOTO_PAGE_CAPACITY_COMPLETO : PHOTO_PAGE_CAPACITY;
      
      for (const imageChunk of chunkArray(imageAssets, capacity)) {
        const { slots } = isGrid3x3
          ? buildPdfPhotoGallerySlotsCompleto(pageWidth, imageChunk.length)
          : { slots: buildPdfPhotoGallerySlots(pageWidth, imageChunk.length) };

        // Calcular altura necesaria
        const rows = Math.ceil(imageChunk.length / (isGrid3x3 ? 3 : 2));
        const totalImageHeight = rows * 155 + (rows - 1) * 10 + 20;
        ensurePdfSpace(doc, cursor, totalImageHeight);

        // Usar imágenes sin procesarlas para mantener calidad
        imageChunk.forEach((asset, idx) => {
          const slot = slots[idx];
          drawLoadedImagePdf(doc, asset, slot.x, cursor.y + slot.y - slots[0].y, slot.width, slot.height, false);
        });

        cursor.y += rows * 155 + (rows - 1) * 10 + 20;
      }
    }
  }

  addCompletoPdfSignatureTable(doc, payload, cursor);
  addPdfPageNumbers(doc);

  const fileName = `inspeccion-${inspection.inspection_date ?? "sf"}-${inspection.id.slice(0, 8)}.pdf`;
  doc.save(fileName);
};

const addPdfPageNumbers = (doc: jsPDF) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`Pagina ${page} de ${pageCount}`, pageWidth / 2, pageHeight - 18, {
      align: "center",
    });
  }
};

const exportNormalToPDF = async (
  inspection: Inspection,
  context: ExportContext,
) => {
  const payload = await buildNormalExportPayload(inspection, context);
  const cornerLogoAsset = await loadCornerLogoAsset();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const cursor: PdfCursor = { y: PAGE_MARGIN };

  addNormalPdfHeader(doc, payload, cursor, cornerLogoAsset);
  addNormalPdfIntro(doc, payload, cursor);
  await addReportPdfTableSections(doc, cursor, context);

  for (let index = 0; index < payload.blocks.length; index += 1) {
    const block = payload.blocks[index];
    const imageAssets = (
      await Promise.all(block.images.map((imageSource) => loadImageAsset(imageSource)))
    ).filter((asset): asset is LoadedImageAsset => Boolean(asset));

    if (index > 0) {
      doc.addPage();
      cursor.y = PAGE_MARGIN + 16;
    }

    doc.setFont("helvetica", "bolditalic");
    doc.setFontSize(14);
    doc.setTextColor(220, 38, 38);
    ensurePdfSpace(doc, cursor, 40);
    doc.text(`Labor: ${block.labor || "-"}`, PAGE_MARGIN + 18, cursor.y);
    cursor.y += 22;
    doc.text(`Puesto: ${block.position || "-"}`, PAGE_MARGIN + 18, cursor.y);
    cursor.y += 28;

    doc.setFont("helvetica", "italic");
    doc.setFontSize(12);
    doc.setTextColor(34, 34, 34);

    if (block.observations.length > 0) {
      drawBulletListPdf(doc, cursor, block.observations, {
        x: PAGE_MARGIN + 14,
        width: pageWidth - PAGE_MARGIN * 2 - 16,
      });
    } else {
      ensurePdfSpace(doc, cursor, 18);
      doc.text("Sin observaciones registradas.", PAGE_MARGIN + 18, cursor.y);
      cursor.y += 22;
    }

    cursor.y += 12;
    const heroImageUsed = await addNormalPdfRecommendations(doc, cursor, block, imageAssets);
    const galleryAssets = heroImageUsed ? imageAssets.slice(1) : imageAssets;
    await addNormalPdfPhotoPages(
      doc,
      block,
      galleryAssets,
      payload.contractName,
      cornerLogoAsset,
    );
  }

  if (payload.finalItems.length > 0) {
    doc.addPage();
    addPdfBadge(doc, payload.contractName, cornerLogoAsset);
    cursor.y = 102;
    drawPdfAccentHeading(doc, cursor, "CONCLUSIONES Y RECOMENDACIONES:", PAGE_MARGIN + 56);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    drawBulletListPdf(doc, cursor, payload.finalItems, {
      x: PAGE_MARGIN + 24,
      width: pageWidth - PAGE_MARGIN * 2 - 24,
    });
    cursor.y += 8;
  }

  addNormalPdfSignatureTable(doc, payload, cursor);
  addPdfPageNumbers(doc);

  const fileName = `inspeccion-${inspection.inspection_date ?? "sf"}-${inspection.id.slice(0, 8)}.pdf`;
  doc.save(fileName);
};

const exportTableLayoutToPDF = async (
  inspection: Inspection,
  context: ExportContext,
) => {
  const payload = await buildNormalExportPayload(inspection, context);
  const cornerLogoAsset = await loadCornerLogoAsset();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const cursor: PdfCursor = { y: PAGE_MARGIN };

  addNormalPdfHeader(doc, payload, cursor, cornerLogoAsset);
  addNormalPdfIntro(doc, payload, cursor);
  await addReportPdfTableSections(doc, cursor, context);

  if (payload.finalItems.length > 0) {
    doc.addPage();
    addPdfBadge(doc, payload.contractName, cornerLogoAsset);
    cursor.y = 102;
    drawPdfAccentHeading(doc, cursor, "CONCLUSIONES Y RECOMENDACIONES:", PAGE_MARGIN + 56);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    drawBulletListPdf(doc, cursor, payload.finalItems, {
      x: PAGE_MARGIN + 24,
      width: pageWidth - PAGE_MARGIN * 2 - 24,
    });
    cursor.y += 8;
  }

  addNormalPdfSignatureTable(doc, payload, cursor);
  addPdfPageNumbers(doc);

  const fileName = `inspeccion-${inspection.inspection_date ?? "sf"}-${inspection.id.slice(0, 8)}.pdf`;
  doc.save(fileName);
};

const buildGenericPdfSectionTitle = (
  doc: jsPDF,
  cursor: PdfCursor,
  title: string,
) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  ensurePdfSpace(doc, cursor, 34);
  doc.setFillColor(241, 245, 249);
  doc.rect(PAGE_MARGIN, cursor.y - 4, pageWidth - PAGE_MARGIN * 2, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.text(title.toUpperCase(), PAGE_MARGIN + 8, cursor.y + 11);
  cursor.y += 32;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);
};

const buildGenericPdfRow = (
  doc: jsPDF,
  cursor: PdfCursor,
  label: string,
  value: string,
) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  ensurePdfSpace(doc, cursor, 24);
  doc.setFont("helvetica", "bold");
  doc.text(label, PAGE_MARGIN, cursor.y);
  doc.setFont("helvetica", "normal");
  const lines = doc.splitTextToSize(value || "-", pageWidth - PAGE_MARGIN * 2 - 140);
  doc.text(lines, PAGE_MARGIN + 140, cursor.y);
  cursor.y += Math.max(16, lines.length * 14);
};

const drawCenteredTextPdf = (
  doc: jsPDF,
  text: string,
  x: number,
  width: number,
  y: number,
) => {
  const textWidth = doc.getTextWidth(text);
  doc.text(text, x + Math.max(0, (width - textWidth) / 2), y);
};

const buildGenericPdfTableGroup = async (
  doc: jsPDF,
  cursor: PdfCursor,
  sectionItem: Extract<InspectionFormatSection, { type: "group" }>,
  context: ExportContext,
) => {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const tableX = PAGE_MARGIN;
  const tableWidth = pageWidth - PAGE_MARGIN * 2;
  const numberWidth = 52;
  const locationWidth = 155;
  const statusWidth = tableWidth - numberWidth - locationWidth;
  const headerHeight = 22;
  const { locationField, statusFields } = getTableGroupFields(sectionItem.fields);

  ensurePdfSpace(doc, cursor, 30);

  const drawHeader = () => {
    ensurePdfSpace(doc, cursor, headerHeight + 8);
    doc.setFillColor(251, 191, 36);
    doc.setDrawColor(0, 0, 0);
    doc.rect(tableX, cursor.y, tableWidth, headerHeight, "FD");
    doc.line(tableX + numberWidth, cursor.y, tableX + numberWidth, cursor.y + headerHeight);
    doc.line(
      tableX + numberWidth + locationWidth,
      cursor.y,
      tableX + numberWidth + locationWidth,
      cursor.y + headerHeight,
    );
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    drawCenteredTextPdf(doc, "Nº", tableX, numberWidth, cursor.y + 14);
    drawCenteredTextPdf(
      doc,
      locationField?.label.toUpperCase() ?? "UBICACION",
      tableX + numberWidth,
      locationWidth,
      cursor.y + 14,
    );
    drawCenteredTextPdf(
      doc,
      "ESTADO",
      tableX + numberWidth + locationWidth,
      statusWidth,
      cursor.y + 14,
    );
    cursor.y += headerHeight;
  };

  drawHeader();

  if (sectionItem.blocks.length === 0) {
    const rowHeight = 32;
    doc.setDrawColor(0, 0, 0);
    doc.rect(tableX, cursor.y, tableWidth, rowHeight);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text("Sin filas registradas", tableX + 8, cursor.y + 20);
    cursor.y += rowHeight + 8;
    return;
  }

  for (const block of sectionItem.blocks) {
    const locationValue = context.fieldValueText(
      locationField?.type ?? "text",
      findBlockEntryValue(block, locationField?.id),
    );
    const statusTextGroups = statusFields
      .filter((field) => field.type !== "image")
      .map((field) => {
        const valueText = context.fieldValueText(field.type, findBlockEntryValue(block, field.id));
        const prefix = normalizeComparisonText(field.label) === "estado" ? "- " : `${field.label}: `;
        return doc.splitTextToSize(`${prefix}${valueText}`, statusWidth - 18) as string[];
      })
      .filter((lines) => lines.length > 0);
    const statusTextHeight = Math.max(
      14,
      statusTextGroups.reduce((height, lines) => height + lines.length * 12 + 4, 0),
    );
    const imageAssets = (
      await Promise.all(
        statusFields
          .filter((field) => field.type === "image")
          .flatMap((field) => getInspectionImageSources(findBlockEntryValue(block, field.id)))
          .map((source) => loadImageAsset(source)),
      )
    ).filter((asset): asset is LoadedImageAsset => Boolean(asset));
    const imageWidth = Math.min(120, (statusWidth - 30) / 2);
    const imageHeight = 118;
    const imageRows = Math.ceil(imageAssets.length / 2);
    const imageBlockHeight = imageAssets.length > 0 ? imageRows * (imageHeight + 8) + 4 : 0;
    const rowHeight = Math.max(78, statusTextHeight + imageBlockHeight + 18);

    if (cursor.y + rowHeight > pageHeight - PAGE_MARGIN) {
      doc.addPage();
      cursor.y = PAGE_MARGIN;
      drawHeader();
    }

    const rowY = cursor.y;
    const statusX = tableX + numberWidth + locationWidth;
    doc.setDrawColor(0, 0, 0);
    doc.rect(tableX, rowY, tableWidth, rowHeight);
    doc.line(tableX + numberWidth, rowY, tableX + numberWidth, rowY + rowHeight);
    doc.line(statusX, rowY, statusX, rowY + rowHeight);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    drawCenteredTextPdf(doc, String(block.index).padStart(2, "0"), tableX, numberWidth, rowY + rowHeight / 2);

    const locationLines = doc.splitTextToSize(locationValue || "-", locationWidth - 14) as string[];
    const locationStartY = rowY + rowHeight / 2 - ((locationLines.length - 1) * 12) / 2;
    locationLines.forEach((line, lineIndex) => {
      drawCenteredTextPdf(
        doc,
        line,
        tableX + numberWidth,
        locationWidth,
        locationStartY + lineIndex * 12,
      );
    });

    let contentY = rowY + 16;
    doc.setTextColor(51, 65, 85);
    statusTextGroups.forEach((lines) => {
      doc.text(lines, statusX + 10, contentY);
      contentY += lines.length * 12 + 4;
    });

    if (imageAssets.length > 0) {
      contentY += 4;
      imageAssets.forEach((asset, imageIndex) => {
        const column = imageIndex % 2;
        const row = Math.floor(imageIndex / 2);
        drawLoadedImagePdf(
          doc,
          asset,
          statusX + 10 + column * (imageWidth + 10),
          contentY + row * (imageHeight + 8),
          imageWidth,
          imageHeight,
          false,
        );
      });
    }

    cursor.y += rowHeight;
  }

  cursor.y += 10;
};

const addReportPdfTableSections = async (
  doc: jsPDF,
  cursor: PdfCursor,
  context: ExportContext,
) => {
  for (const sectionItem of context.formatSections) {
    if (sectionItem.type !== "group" || getRepeatableLayout(sectionItem.fields) !== "table") {
      continue;
    }

    await buildGenericPdfTableGroup(doc, cursor, sectionItem, context);
  }
};

const isHeaderOrSignatureField = (field: ContractFieldDefinition) =>
  [
    NORMAL_FIELD_MATCHERS.initialDescription,
    NORMAL_FIELD_MATCHERS.finalConclusions,
    NORMAL_FIELD_MATCHERS.elaboratedBy,
    NORMAL_FIELD_MATCHERS.reviewedBy,
    NORMAL_FIELD_MATCHERS.approvedBy,
    COMPLETO_FIELD_MATCHERS.initialDescription,
    COMPLETO_FIELD_MATCHERS.elaboratedBy,
    COMPLETO_FIELD_MATCHERS.reviewedBy,
    COMPLETO_FIELD_MATCHERS.approvedBy,
  ].some((matcher) => fieldMatches(field, matcher));

const hasFormatImageValues = (context: ExportContext) =>
  context.formatSections.some((sectionItem) => {
    if (sectionItem.type === "field") {
      return (
        sectionItem.field.type === "image" &&
        getInspectionImageSources(sectionItem.value).length > 0
      );
    }

    return sectionItem.blocks.some((block) =>
      block.entries.some(
        ({ field, value }) =>
          field.type === "image" && getInspectionImageSources(value).length > 0,
      ),
    );
  });

const addCustomMemoSingleField = async (
  doc: jsPDF,
  cursor: PdfCursor,
  sectionItem: Extract<InspectionFormatSection, { type: "field" }>,
  context: ExportContext,
) => {
  const pageWidth = doc.internal.pageSize.getWidth();

  if (sectionItem.field.type !== "image") {
    buildGenericPdfRow(
      doc,
      cursor,
      `${sectionItem.field.label}:`,
      context.fieldValueText(sectionItem.field.type, sectionItem.value),
    );
    return;
  }

  const imageSources = getInspectionImageSources(sectionItem.value);
  buildGenericPdfRow(
    doc,
    cursor,
    `${sectionItem.field.label}:`,
    imageSources.length > 0 ? `${imageSources.length} imagen(es) adjuntas` : "Sin imagen",
  );

  const imageAssets = (
    await Promise.all(imageSources.map((imageSource) => loadImageAsset(imageSource)))
  ).filter((asset): asset is LoadedImageAsset => Boolean(asset));

  if (imageAssets.length === 0) return;

  const imageWidth = 130;
  const imageHeight = 100;
  const gap = 12;
  const columns = Math.max(
    1,
    Math.floor((pageWidth - PAGE_MARGIN * 2 + gap) / (imageWidth + gap)),
  );

  for (const imageRow of chunkArray(imageAssets, columns)) {
    ensurePdfSpace(doc, cursor, imageHeight + gap);

    imageRow.forEach((asset, column) => {
      drawLoadedImagePdf(
        doc,
        asset,
        PAGE_MARGIN + column * (imageWidth + gap),
        cursor.y,
        imageWidth,
        imageHeight,
        false,
      );
    });

    cursor.y += imageHeight + gap;
  }

  cursor.y += 8;
};

const addCustomMemoFormatSections = async (
  doc: jsPDF,
  cursor: PdfCursor,
  context: ExportContext,
) => {
  for (const sectionItem of context.formatSections) {
    if (sectionItem.type === "field") {
      if (!isHeaderOrSignatureField(sectionItem.field)) {
        await addCustomMemoSingleField(doc, cursor, sectionItem, context);
      }
      continue;
    }

    await buildGenericPdfTableGroup(doc, cursor, sectionItem, context);
  }
};

const addGenericEvidenceSection = async (
  doc: jsPDF,
  cursor: PdfCursor,
  evidences: Evidence[],
) => {
  if (evidences.length === 0) return;

  const pageWidth = doc.internal.pageSize.getWidth();
  drawPdfAccentHeading(doc, cursor, `EVIDENCIAS (${evidences.length}):`, PAGE_MARGIN + 18);

  for (const evidence of evidences) {
    ensurePdfSpace(doc, cursor, 190);
    const imageSource = getEvidenceImageSource(evidence);
    const asset = imageSource ? await loadImageAsset(imageSource) : null;

    if (asset) {
      drawLoadedImagePdf(doc, asset, PAGE_MARGIN, cursor.y, 200, 150);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(220, 38, 38);
    doc.text(getEvidenceLabel(evidence), PAGE_MARGIN + 215, cursor.y + 14);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    const comment = doc.splitTextToSize(
      evidence.created_at
        ? `Registrada el ${new Date(evidence.created_at).toLocaleString("es")}`
        : "Sin detalle adicional",
      pageWidth - PAGE_MARGIN * 2 - 220,
    );
    doc.text(comment, PAGE_MARGIN + 215, cursor.y + 32);
    cursor.y += 170;
  }
};

const exportCustomMemoToPDF = async (
  inspection: Inspection,
  evidences: Evidence[],
  context: ExportContext,
) => {
  const payload = await buildNormalExportPayload(inspection, context);
  const cornerLogoAsset = await loadCornerLogoAsset();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const cursor: PdfCursor = { y: PAGE_MARGIN };

  addNormalPdfHeader(doc, payload, cursor, cornerLogoAsset);
  addNormalPdfIntro(doc, payload, cursor);
  await addCustomMemoFormatSections(doc, cursor, context);

  if (payload.finalItems.length > 0) {
    cursor.y += 8;
    drawPdfAccentHeading(doc, cursor, "CONCLUSIONES Y RECOMENDACIONES:", PAGE_MARGIN + 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    drawBulletListPdf(doc, cursor, payload.finalItems, {
      x: PAGE_MARGIN + 24,
      width: pageWidth - PAGE_MARGIN * 2 - 24,
    });
  }

  if (!hasFormatImageValues(context)) {
    await addGenericEvidenceSection(doc, cursor, evidences);
  }

  addNormalPdfSignatureTable(doc, payload, cursor);
  addPdfPageNumbers(doc);

  const fileName = `inspeccion-${inspection.inspection_date ?? "sf"}-${inspection.id.slice(0, 8)}.pdf`;
  doc.save(fileName);
};

const exportGenericToPDF = async (
  inspection: Inspection,
  evidences: Evidence[],
  context: ExportContext,
) => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const cursor: PdfCursor = { y: 110 };

  doc.setFillColor(30, 41, 59);
  doc.rect(0, 0, pageWidth, 80, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("Reporte de Inspeccion", PAGE_MARGIN, 38);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Generado el ${new Date().toLocaleDateString("es")}`, PAGE_MARGIN, 58);

  doc.setTextColor(15, 23, 42);

  buildGenericPdfSectionTitle(doc, cursor, "Contrato");
  buildGenericPdfRow(doc, cursor, "Nombre:", context.contractName);
  buildGenericPdfRow(doc, cursor, "Formato:", context.formatName ?? "Sin formato guardado");
  if (context.formatDescription) {
    buildGenericPdfRow(doc, cursor, "Descripcion:", context.formatDescription);
  }

  buildGenericPdfSectionTitle(doc, cursor, "Datos generales");
  buildGenericPdfRow(doc, cursor, "Titulo:", inspection.title ?? inspection.area ?? "-");
  buildGenericPdfRow(doc, cursor, "Para:", inspection.location ?? "-");
  buildGenericPdfRow(doc, cursor, "DE:", inspection.specific_site ?? "-");
  buildGenericPdfRow(doc, cursor, "Asunto:", inspection.subject ?? inspection.personnel_in_charge ?? "-");
  buildGenericPdfRow(doc, cursor, "Fecha:", inspection.inspection_date ?? "-");

  buildGenericPdfSectionTitle(doc, cursor, "Campos del formato");
  if (context.formatSections.length === 0) {
    buildGenericPdfRow(doc, cursor, "Campos:", "Sin datos especificos");
  } else {
    for (const sectionItem of context.formatSections) {
      if (sectionItem.type === "field") {
        buildGenericPdfRow(
          doc,
          cursor,
          `${sectionItem.field.label}:`,
          context.fieldValueText(sectionItem.field.type, sectionItem.value),
        );
        continue;
      }

      if (getRepeatableLayout(sectionItem.fields) === "table") {
        await buildGenericPdfTableGroup(doc, cursor, sectionItem, context);
        continue;
      }

      if (sectionItem.blocks.length === 0) {
        buildGenericPdfRow(doc, cursor, `${getRepeatableGroupLabel(sectionItem.groupKey)}:`, "Sin bloques registrados");
        continue;
      }

      buildGenericPdfRow(doc, cursor, `${getRepeatableGroupLabel(sectionItem.groupKey)}:`, "");

      for (const block of sectionItem.blocks) {
        ensurePdfSpace(doc, cursor, 24);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(30, 41, 59);
        doc.text(`Bloque ${block.index}`, PAGE_MARGIN + 10, cursor.y);
        cursor.y += 16;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(51, 65, 85);

        const blockImages: LoadedImageAsset[] = [];

        for (const { field, value } of block.entries) {
          if (field.type === "image") {
            const sources = getInspectionImageSources(value);
            const loadedImages = (
              await Promise.all(sources.map((source) => loadImageAsset(source)))
            ).filter((asset): asset is LoadedImageAsset => Boolean(asset));
            blockImages.push(...loadedImages);
          } else {
            buildGenericPdfRow(doc, cursor, `  ${field.label}:`, context.fieldValueText(field.type, value));
          }
        }

        if (blockImages.length > 0) {
          ensurePdfSpace(doc, cursor, 220);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(9);
          doc.setTextColor(51, 65, 85);
          doc.text("Imagenes del bloque:", PAGE_MARGIN + 10, cursor.y);
          cursor.y += 14;

          const imageWidth = 90;
          const imageHeight = 90;
          const spacing = 12;

          blockImages.forEach((asset, imageIndex) => {
            const column = imageIndex % 2;
            const row = Math.floor(imageIndex / 2);
            const x = PAGE_MARGIN + 10 + column * (imageWidth + spacing);
            const y = cursor.y + row * (imageHeight + spacing);
            drawLoadedImagePdf(doc, asset, x, y, imageWidth, imageHeight);
          });

          cursor.y += Math.ceil(blockImages.length / 2) * (imageHeight + spacing) + 10;
        }
      }
    }
  }

  if (evidences.length > 0) {
    buildGenericPdfSectionTitle(doc, cursor, `Evidencias (${evidences.length})`);

    for (const evidence of evidences) {
      ensurePdfSpace(doc, cursor, 190);
      const imageSource = getEvidenceImageSource(evidence);
      const asset = imageSource ? await loadImageAsset(imageSource) : null;

      if (asset) {
        drawLoadedImagePdf(doc, asset, PAGE_MARGIN, cursor.y, 200, 150);
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(220, 38, 38);
      doc.text(getEvidenceLabel(evidence), PAGE_MARGIN + 215, cursor.y + 14);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      const comment = doc.splitTextToSize(
        evidence.created_at
          ? `Registrada el ${new Date(evidence.created_at).toLocaleString("es")}`
          : "Sin detalle adicional",
        pageWidth - PAGE_MARGIN * 2 - 220,
      );
      doc.text(comment, PAGE_MARGIN + 215, cursor.y + 32);
      cursor.y += 170;
    }
  }

  buildGenericPdfSectionTitle(doc, cursor, "Conclusion");
  buildGenericPdfRow(doc, cursor, "Estado:", inspection.status === "completed" ? "Completada" : inspection.status);
  addPdfPageNumbers(doc);

  const fileName = `inspeccion-${inspection.inspection_date ?? "sf"}-${inspection.id.slice(0, 8)}.pdf`;
  doc.save(fileName);
};

const createTextRun = (text: string, options: Partial<ConstructorParameters<typeof TextRun>[0]> = {}) =>
  new TextRun({
    text,
    ...options,
  });

const createTextParagraph = (
  text: string,
  options: ConstructorParameters<typeof Paragraph>[0] = {},
) =>
  new Paragraph({
    ...options,
    children:
      "children" in options && options.children
        ? options.children
        : [createTextRun(text || "-")],
  });

const createBulletParagraph = (text: string) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [createTextRun(text)],
  });

const createAccentHeadingParagraph = (
  text: string,
  options: {
    pageBreakBefore?: boolean;
    spacingAfter?: number;
  } = {},
) =>
  createTextParagraph(text.toUpperCase(), {
    pageBreakBefore: options.pageBreakBefore,
    spacing: { after: options.spacingAfter ?? 120 },
    children: [
      createTextRun(text.toUpperCase(), {
        bold: true,
        size: 24,
        color: "0070C0",
        underline: {
          type: UnderlineType.SINGLE,
          color: "0070C0",
        },
      }),
    ],
  });

const createDocxImageParagraph = (
  asset: LoadedImageAsset,
  maxWidth: number,
  maxHeight: number,
  alignment = AlignmentType.CENTER,
  options: {
    spacingAfter?: number;
    pageBreakBefore?: boolean;
  } = {},
) => {
  const dimensions = fitInsideBox(asset.width, asset.height, maxWidth, maxHeight);

  return new Paragraph({
    alignment,
    pageBreakBefore: options.pageBreakBefore,
    spacing: { after: options.spacingAfter ?? 120 },
    children: [
      new ImageRun({
        type: asset.type,
        data: asset.buffer,
        transformation: {
          width: dimensions.width,
          height: dimensions.height,
        },
      }),
    ],
  });
};

const buildSignatureCellText = (signature: SignaturePerson) => {
  if (!signature.name && !signature.role) {
    return [createTextParagraph("", { alignment: AlignmentType.CENTER })];
  }

  return [
    createTextParagraph(signature.name || "", {
      alignment: AlignmentType.CENTER,
      spacing: { after: signature.role ? 40 : 0 },
      children: [
        createTextRun(signature.name || "", {
          bold: true,
          size: 18,
        }),
      ],
    }),
    ...(signature.role
      ? [
          createTextParagraph(signature.role, {
            alignment: AlignmentType.CENTER,
            children: [
              createTextRun(signature.role, {
                size: 16,
              }),
            ],
          }),
        ]
      : []),
  ];
};

const createSignatureTable = (payload: NormalExportPayload) => {
  const border = { style: BorderStyle.SINGLE, size: 1, color: "000000" };
  const borders = {
    top: border,
    bottom: border,
    left: border,
    right: border,
  };
  const signatures = [
    payload.signatures.elaboratedBy,
    payload.signatures.reviewedBy,
    payload.signatures.approvedBy,
  ];

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3120, 3120, 3120],
    rows: [
      new TableRow({
        children: SIGNATURE_TABLE_HEADERS.map(
          (header) =>
            new TableCell({
              width: { size: 3120, type: WidthType.DXA },
              borders,
              margins: { top: 60, bottom: 60, left: 120, right: 120 },
              children: [
                createTextParagraph(header, {
                  children: [createTextRun(header, { bold: true, size: 16 })],
                }),
              ],
            }),
        ),
      }),
      new TableRow({
        height: { value: 2000, rule: HeightRule.ATLEAST },
        children: signatures.map(
          (signature) =>
            new TableCell({
              width: { size: 3120, type: WidthType.DXA },
              verticalAlign: VerticalAlign.BOTTOM,
              borders,
              margins: { top: 140, bottom: 140, left: 120, right: 120 },
              children: buildSignatureCellText(signature),
            }),
        ),
      }),
    ],
  });
};

const createMemoInfoTable = (payload: NormalExportPayload) => {
  const noBorder = {
    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  };
  const labelCell = (label: string) =>
    new TableCell({
      width: { size: 1500, type: WidthType.DXA },
      borders: noBorder,
      margins: { top: 60, bottom: 30, left: 0, right: 80 },
      children: [
        createTextParagraph(label, {
          children: [createTextRun(label, { bold: true, size: 22 })],
        }),
      ],
    });
  const textCell = (paragraphs: Paragraph[]) =>
    new TableCell({
      width: { size: 7860, type: WidthType.DXA },
      borders: noBorder,
      margins: { top: 60, bottom: 30, left: 0, right: 0 },
      children: paragraphs,
    });

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: [
          labelCell("PARA"),
          textCell([
            createTextParagraph(`: ${payload.recipient.name || "-"}`, {
              children: [createTextRun(`: ${payload.recipient.name || "-"}`, { size: 22 })],
            }),
            ...(payload.recipient.role
              ? [
                  createTextParagraph(payload.recipient.role, {
                    children: [createTextRun(payload.recipient.role, { bold: true, size: 22 })],
                  }),
                ]
              : []),
          ]),
        ],
      }),
      new TableRow({
        children: [
          labelCell("DE"),
          textCell([
            createTextParagraph(`: ${payload.sender.name || "-"}`, {
              children: [createTextRun(`: ${payload.sender.name || "-"}`, { size: 22 })],
            }),
            ...(payload.sender.role
              ? [
                  createTextParagraph(payload.sender.role, {
                    children: [createTextRun(payload.sender.role, { bold: true, size: 22 })],
                  }),
                ]
              : []),
          ]),
        ],
      }),
      new TableRow({
        children: [
          labelCell("ASUNTO"),
          textCell([
            createTextParagraph(`: ${payload.subject || "-"}`, {
              children: [createTextRun(`: ${payload.subject || "-"}`, { size: 22 })],
            }),
          ]),
        ],
      }),
      new TableRow({
        children: [
          labelCell("Fecha"),
          textCell([
            createTextParagraph(`: ${payload.memoDate}`, {
              children: [createTextRun(`: ${payload.memoDate}`, { size: 22 })],
            }),
          ]),
        ],
      }),
    ],
  });
};

const createDocxPhotoPage = async (
  imageAssets: LoadedImageAsset[],
  cornerLogoAsset: LoadedImageAsset | null,
  contractName: string,
) => {
  const children: (Paragraph | Table)[] = [];

  for (const imageChunk of chunkArray(imageAssets, PHOTO_PAGE_CAPACITY)) {
    const spec = getPhotoGallerySpec(imageChunk.length);
    const preparedAssets = await Promise.all(
      imageChunk.map((asset) =>
        prepareImageAssetForFrame(asset, spec.boxWidth, spec.boxHeight, {
          fitMode: "contain",
          trimWhitespace: true,
        }),
      ),
    );

    if (cornerLogoAsset) {
      children.push(
        createDocxImageParagraph(cornerLogoAsset, 120, 52, AlignmentType.LEFT, {
          pageBreakBefore: true,
          spacingAfter: 40,
        }),
      );
    } else {
      children.push(
        createTextParagraph(contractName, {
          pageBreakBefore: true,
          spacing: { after: 40 },
          children: [
            createTextRun(contractName, {
              bold: true,
              color: "90B37C",
              size: 24,
            }),
          ],
        }),
      );
    }

    if (spec.columns === 1 && preparedAssets[0]) {
      children.push(
        createDocxImageParagraph(
          preparedAssets[0],
          spec.boxWidth,
          spec.boxHeight,
          AlignmentType.CENTER,
          { spacingAfter: 0 },
        ),
      );
      continue;
    }

    const cellBorder = {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    };
    const rows = chunkArray(preparedAssets, spec.columns).map(
      (rowAssets) =>
        new TableRow({
          children: Array.from({ length: spec.columns }, (_, columnIndex) => {
            const asset = rowAssets[columnIndex];

            return new TableCell({
              borders: cellBorder,
              margins: { top: 60, bottom: 60, left: 60, right: 60 },
              children: asset
                ? [
                    createDocxImageParagraph(
                      asset,
                      spec.boxWidth,
                      spec.boxHeight,
                      AlignmentType.CENTER,
                      { spacingAfter: 0 },
                    ),
                  ]
                : [createTextParagraph("")],
            });
          }),
        }),
    );

    children.push(
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: Array.from({ length: spec.columns }, () => Math.floor(9360 / spec.columns)),
        rows,
      }),
    );
  }

  return children;
};

const exportNormalToDOCX = async (
  inspection: Inspection,
  context: ExportContext,
) => {
  const payload = await buildNormalExportPayload(inspection, context);
  const cornerLogoAsset = await loadCornerLogoAsset();
  const children: (Paragraph | Table)[] = [
    ...(cornerLogoAsset
      ? [
          createDocxImageParagraph(cornerLogoAsset, 120, 52, AlignmentType.LEFT, {
            spacingAfter: 60,
          }),
        ]
      : [
          createTextParagraph(payload.contractName, {
            spacing: { after: 60 },
            children: [
              createTextRun(payload.contractName, {
                bold: true,
                color: "90B37C",
                size: 26,
              }),
            ],
          }),
        ]),
    createTextParagraph(payload.reportTitle, {
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [
        createTextRun(payload.reportTitle, {
          bold: true,
          size: 28,
        }),
      ],
    }),
    createMemoInfoTable(payload),
    createTextParagraph("", {
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
      },
      spacing: { after: 180 },
    }),
    ...payload.introParagraphs.map((paragraph) =>
      createTextParagraph(paragraph, {
        spacing: { after: 120 },
        children: [createTextRun(paragraph, { italics: true, size: 22 })],
      }),
    ),
  ];

  for (let index = 0; index < payload.blocks.length; index += 1) {
    const block = payload.blocks[index];
    const imageAssets = (
      await Promise.all(block.images.map((imageSource) => loadImageAsset(imageSource)))
    ).filter((asset): asset is LoadedImageAsset => Boolean(asset));
    const heroImage = imageAssets[0]
      ? await prepareImageAssetForFrame(imageAssets[0], 240, 300, {
          fitMode: "contain",
          trimWhitespace: true,
        })
      : null;
    const galleryAssets = heroImage ? imageAssets.slice(1) : imageAssets;

    children.push(
      createTextParagraph(`Labor: ${block.labor || "-"}`, {
        pageBreakBefore: index > 0,
        spacing: { before: 120, after: 60 },
        children: [
          createTextRun(`Labor: ${block.labor || "-"}`, {
            bold: true,
            italics: true,
            color: "DC2626",
            size: 24,
          }),
        ],
      }),
    );
    children.push(
      createTextParagraph(`Puesto: ${block.position || "-"}`, {
        spacing: { after: 140 },
        children: [
          createTextRun(`Puesto: ${block.position || "-"}`, {
            bold: true,
            italics: true,
            color: "DC2626",
            size: 24,
          }),
        ],
      }),
    );

    if (block.observations.length > 0) {
      children.push(...block.observations.map((item) => createBulletParagraph(item)));
    } else {
      children.push(createTextParagraph("Sin observaciones registradas."));
    }

    children.push(createAccentHeadingParagraph("RECOMENDACIONES:", { spacingAfter: 80 }));

    const recommendationChildren =
      block.recommendations.length > 0
        ? block.recommendations.map((item) => createBulletParagraph(item))
        : [createTextParagraph("Sin recomendaciones registradas.")];

    if (heroImage) {
      children.push(
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [5600, 3760],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: {
                    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                  },
                  children: recommendationChildren,
                }),
                new TableCell({
                  borders: {
                    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                  },
                  children: [createDocxImageParagraph(heroImage, 240, 300)],
                }),
              ],
            }),
          ],
        }),
      );
    } else {
      children.push(...recommendationChildren);
    }

    if (galleryAssets.length > 0) {
      children.push(
        ...(await createDocxPhotoPage(
          galleryAssets,
          cornerLogoAsset,
          payload.contractName,
        )),
      );
    }
  }

  if (payload.finalItems.length > 0) {
    if (cornerLogoAsset) {
      children.push(
        createDocxImageParagraph(cornerLogoAsset, 120, 52, AlignmentType.LEFT, {
          pageBreakBefore: true,
          spacingAfter: 50,
        }),
      );
    } else {
      children.push(
        createTextParagraph(payload.contractName, {
          pageBreakBefore: true,
          spacing: { after: 50 },
          children: [
            createTextRun(payload.contractName, {
              bold: true,
              color: "90B37C",
              size: 24,
            }),
          ],
        }),
      );
    }

    children.push(
      createAccentHeadingParagraph("CONCLUSIONES Y RECOMENDACIONES:", {
        spacingAfter: 100,
      }),
    );
    children.push(...payload.finalItems.map((item) => createBulletParagraph(item)));
  }

  children.push(createTextParagraph("", { spacing: { after: 80 } }));
  children.push(createSignatureTable(payload));

  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Arial",
            size: 22,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 960, right: 900, bottom: 900, left: 900 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(document);
  const fileName = `inspeccion-${inspection.inspection_date ?? "sf"}-${inspection.id.slice(0, 8)}.docx`;
  saveAs(blob, fileName);
};

const createGenericDataRow = (
  label: string,
  value: string,
  borders: {
    top: { style: BorderStyle; size: number; color: string };
    bottom: { style: BorderStyle; size: number; color: string };
    left: { style: BorderStyle; size: number; color: string };
    right: { style: BorderStyle; size: number; color: string };
  },
) =>
  new TableRow({
    children: [
      new TableCell({
        width: { size: 3000, type: WidthType.DXA },
        borders,
        shading: { fill: "F1F5F9", type: ShadingType.CLEAR, color: "auto" },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [createTextParagraph(label, { children: [createTextRun(label, { bold: true })] })],
      }),
      new TableCell({
        width: { size: 6360, type: WidthType.DXA },
        borders,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [createTextParagraph(value || "-")],
      }),
    ],
  });

const createGenericSectionHeading = (text: string) =>
  createTextParagraph(text, {
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 120 },
    children: [createTextRun(text, { bold: true, color: "1E293B" })],
  });

const createDocxTableHeaderCell = (text: string, width: number) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
    },
    shading: { fill: "FBBF24", type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 70, bottom: 70, left: 80, right: 80 },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      createTextParagraph(text, {
        alignment: AlignmentType.CENTER,
        children: [createTextRun(text, { bold: true })],
      }),
    ],
  });

const createDocxTableCell = (
  children: (Paragraph | Table)[],
  width: number,
  alignCenter = false,
) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
    },
    margins: { top: 100, bottom: 100, left: 100, right: 100 },
    verticalAlign: VerticalAlign.CENTER,
    children: children.length > 0
      ? children
      : [
          createTextParagraph("-", {
            alignment: alignCenter ? AlignmentType.CENTER : AlignmentType.LEFT,
          }),
        ],
  });

const createDocxImageGridTable = (assets: LoadedImageAsset[]) => {
  const emptyBorders = {
    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  };

  return new Table({
    width: { size: 6200, type: WidthType.DXA },
    columnWidths: [3100, 3100],
    rows: chunkArray(assets, 2).map(
      (rowAssets) =>
        new TableRow({
          children: Array.from({ length: 2 }, (_, index) => {
            const asset = rowAssets[index];

            return new TableCell({
              width: { size: 3100, type: WidthType.DXA },
              borders: emptyBorders,
              margins: { top: 80, bottom: 80, left: 60, right: 60 },
              children: asset
                ? [createDocxImageParagraph(asset, 170, 170, AlignmentType.CENTER)]
                : [createTextParagraph("")],
            });
          }),
        }),
    ),
  });
};

const buildGenericDocxTableGroup = async (
  sectionItem: Extract<InspectionFormatSection, { type: "group" }>,
  context: ExportContext,
): Promise<(Paragraph | Table)[]> => {
  const { locationField, statusFields } = getTableGroupFields(sectionItem.fields);
  const columnWidths = [760, 2400, 6200];
  const rows: TableRow[] = [
    new TableRow({
      children: [
        createDocxTableHeaderCell("Nº", columnWidths[0]),
        createDocxTableHeaderCell(locationField?.label.toUpperCase() ?? "UBICACION", columnWidths[1]),
        createDocxTableHeaderCell("ESTADO", columnWidths[2]),
      ],
    }),
  ];

  if (sectionItem.blocks.length === 0) {
    rows.push(
      new TableRow({
        children: [
          createDocxTableCell([createTextParagraph("-")], columnWidths[0], true),
          createDocxTableCell([createTextParagraph("-")], columnWidths[1], true),
          createDocxTableCell([createTextParagraph("Sin filas registradas")], columnWidths[2]),
        ],
      }),
    );
  }

  for (const block of sectionItem.blocks) {
    const locationValue = context.fieldValueText(
      locationField?.type ?? "text",
      findBlockEntryValue(block, locationField?.id),
    );
    const statusChildren: (Paragraph | Table)[] = [];

    for (const field of statusFields) {
      const value = findBlockEntryValue(block, field.id);

      if (field.type === "image") {
        const imageAssets = (
          await Promise.all(
            getInspectionImageSources(value).map((imageSource) => loadImageAsset(imageSource)),
          )
        ).filter((asset): asset is LoadedImageAsset => Boolean(asset));

        if (imageAssets.length > 0) {
          statusChildren.push(createDocxImageGridTable(imageAssets));
        }
        continue;
      }

      const valueText = context.fieldValueText(field.type, value);
      const prefix = normalizeComparisonText(field.label) === "estado" ? "" : `${field.label}: `;
      statusChildren.push(
        createTextParagraph(`${prefix}${valueText}`, {
          spacing: { after: 80 },
          children: [
            createTextRun(prefix, { bold: Boolean(prefix) }),
            createTextRun(valueText),
          ],
        }),
      );
    }

    rows.push(
      new TableRow({
        children: [
          createDocxTableCell(
            [
              createTextParagraph(String(block.index).padStart(2, "0"), {
                alignment: AlignmentType.CENTER,
              }),
            ],
            columnWidths[0],
            true,
          ),
          createDocxTableCell(
            [
              createTextParagraph(locationValue || "-", {
                alignment: AlignmentType.CENTER,
              }),
            ],
            columnWidths[1],
            true,
          ),
          createDocxTableCell(statusChildren, columnWidths[2]),
        ],
      }),
    );
  }

  return [
    createTextParagraph(getRepeatableGroupLabel(sectionItem.groupKey), {
      spacing: { before: 200, after: 100 },
      children: [
        createTextRun(getRepeatableGroupLabel(sectionItem.groupKey), {
          bold: true,
          color: "1E293B",
        }),
      ],
    }),
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths,
      rows,
    }),
  ];
};

const exportGenericToDOCX = async (
  inspection: Inspection,
  evidences: Evidence[],
  context: ExportContext,
) => {
  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const cellBorders = {
    top: cellBorder,
    bottom: cellBorder,
    left: cellBorder,
    right: cellBorder,
  };
  const dataRow = (label: string, value: string) => createGenericDataRow(label, value, cellBorders);

  const generalRows = [
    dataRow("Titulo", inspection.title ?? inspection.area ?? "-"),
    dataRow("Para", inspection.location ?? "-"),
    dataRow("DE", inspection.specific_site ?? "-"),
    dataRow("Asunto", inspection.subject ?? inspection.personnel_in_charge ?? "-"),
    dataRow("Fecha", inspection.inspection_date ?? "-"),
  ];

  const formatRows = [
    dataRow("Contrato", context.contractName),
    dataRow("Formato", context.formatName ?? "Sin formato guardado"),
    ...(context.formatDescription ? [dataRow("Descripcion", context.formatDescription)] : []),
  ];

  const blockChildren: (Paragraph | Table)[] = [];
  if (context.formatSections.length > 0) {
    for (const sectionItem of context.formatSections) {
      if (sectionItem.type !== "group") continue;

      if (getRepeatableLayout(sectionItem.fields) === "table") {
        blockChildren.push(...(await buildGenericDocxTableGroup(sectionItem, context)));
        continue;
      }

      if (sectionItem.blocks.length === 0) continue;

      for (const block of sectionItem.blocks) {
        const blockFields: Array<{ field: ContractFieldDefinition; value: unknown }> = [];
        const blockImages: LoadedImageAsset[] = [];

        for (const { field, value } of block.entries) {
          if (field.type === "image") {
            const imageAssets = (
              await Promise.all(
                getInspectionImageSources(value).map((imageSource) => loadImageAsset(imageSource)),
              )
            ).filter((asset): asset is LoadedImageAsset => Boolean(asset));
            blockImages.push(...imageAssets);
          } else {
            blockFields.push({ field, value });
          }
        }

        if (blockFields.length > 0) {
          blockChildren.push(
            createTextParagraph(`Bloque ${block.index}`, {
              spacing: { before: 200, after: 100 },
              children: [createTextRun(`Bloque ${block.index}`, { bold: true, color: "1E293B" })],
            }),
          );
          blockChildren.push(
            new Table({
              width: { size: 9360, type: WidthType.DXA },
              columnWidths: [3000, 6360],
              rows: blockFields.map(({ field, value }) =>
                dataRow(field.label, context.fieldValueText(field.type, value)),
              ),
            }),
          );
        }

        if (blockImages.length > 0) {
          blockChildren.push(
            createTextParagraph("Imagenes:", {
              spacing: { before: 150, after: 150 },
              children: [createTextRun("Imagenes:", { bold: true, color: "64748B", size: 20 })],
            }),
          );
          blockChildren.push(
            new Table({
              width: { size: 9360, type: WidthType.DXA },
              columnWidths: [4680, 4680],
              rows: chunkArray(blockImages, 2).map(
                (rowImages) =>
                  new TableRow({
                    children: rowImages.map(
                      (asset) =>
                        new TableCell({
                          width: { size: 4680, type: WidthType.DXA },
                          borders: cellBorders,
                          margins: { top: 80, bottom: 80, left: 60, right: 60 },
                          children: [createDocxImageParagraph(asset, 200, 200)],
                        }),
                    ),
                  }),
              ),
            }),
          );
        }
      }
    }
  }

  const fieldRows =
    context.formatSections.length > 0
      ? context.formatSections.flatMap((sectionItem) => {
          if (sectionItem.type !== "field") return [];

          return [
            dataRow(
              sectionItem.field.label,
              context.fieldValueText(sectionItem.field.type, sectionItem.value),
            ),
          ];
        })
      : [dataRow("Campos", "Sin datos especificos")];

  const evidenceChildren: Paragraph[] = [];
  for (const evidence of evidences) {
    const imageSource = getEvidenceImageSource(evidence);
    const asset = imageSource ? await loadImageAsset(imageSource) : null;

    if (asset) {
      evidenceChildren.push(createDocxImageParagraph(asset, 360, 270, AlignmentType.LEFT));
    }

    evidenceChildren.push(
      createTextParagraph(
        evidence.created_at
          ? `[${getEvidenceLabel(evidence)}] Registrada el ${new Date(evidence.created_at).toLocaleString("es")}`
          : `[${getEvidenceLabel(evidence)}] Sin detalle adicional`,
        {
          spacing: { after: 80 },
          children: [
            createTextRun(`[${getEvidenceLabel(evidence)}] `, {
              bold: true,
              color: "DC2626",
            }),
            createTextRun(
              evidence.created_at
                ? `Registrada el ${new Date(evidence.created_at).toLocaleString("es")}`
                : "Sin detalle adicional",
            ),
          ],
        },
      ),
    );
  }

  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Arial",
            size: 22,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
          },
        },
        children: [
          createTextParagraph("Reporte de Inspeccion", {
            alignment: AlignmentType.CENTER,
            spacing: { after: 80 },
            children: [
              createTextRun("Reporte de Inspeccion", {
                bold: true,
                size: 36,
                color: "1E293B",
              }),
            ],
          }),
          createTextParagraph(`Generado el ${new Date().toLocaleDateString("es")}`, {
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            children: [
              createTextRun(`Generado el ${new Date().toLocaleDateString("es")}`, {
                color: "64748B",
                size: 18,
              }),
            ],
          }),
          createGenericSectionHeading("Contrato"),
          new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [3000, 6360],
            rows: formatRows,
          }),
          createGenericSectionHeading("Datos generales"),
          new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [3000, 6360],
            rows: generalRows,
          }),
          createGenericSectionHeading("Campos del formato"),
          ...(fieldRows.length > 0
            ? [
                new Table({
                  width: { size: 9360, type: WidthType.DXA },
                  columnWidths: [3000, 6360],
                  rows: fieldRows,
                }),
              ]
            : []),
          ...(blockChildren.length > 0
            ? [createGenericSectionHeading("Bloques de inspeccion"), ...blockChildren]
            : []),
          ...(evidences.length > 0
            ? [createGenericSectionHeading(`Evidencias (${evidences.length})`), ...evidenceChildren]
            : []),
          createGenericSectionHeading("Conclusion"),
          new Table({
            width: { size: 9360, type: WidthType.DXA },
            columnWidths: [3000, 6360],
            rows: [dataRow("Estado", inspection.status === "completed" ? "Completada" : inspection.status)],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(document);
  const fileName = `inspeccion-${inspection.inspection_date ?? "sf"}-${inspection.id.slice(0, 8)}.docx`;
  saveAs(blob, fileName);
};

export const exportToPDF = async (inspection: Inspection, evidences: Evidence[]) => {
  const context = getExportContext(inspection);

  if (shouldUseNormalLayout(context)) {
    await exportNormalToPDF(inspection, context);
    return;
  }

  if (shouldUseCompletoLayout(context)) {
    await exportCompletoToPDF(inspection, context);
    return;
  }

  if (hasTableLayoutSections(context) || context.formatSections.length > 0) {
    await exportCustomMemoToPDF(inspection, evidences, context);
    return;
  }

  await exportGenericToPDF(inspection, evidences, context);
};

export const exportToDOCX = async (inspection: Inspection, evidences: Evidence[]) => {
  const context = getExportContext(inspection);

  if (shouldUseNormalLayout(context)) {
    await exportNormalToDOCX(inspection, context);
    return;
  }

  await exportGenericToDOCX(inspection, evidences, context);
};
