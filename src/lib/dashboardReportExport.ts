import jsPDF from "jspdf";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

export interface DashboardReportInspection {
  id: string;
  user_id: string;
  contract_type: string | null;
  inspection_date: string | null;
  subject: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  creator_name: string | null;
}

interface DashboardReportExportOptions {
  inspections: DashboardReportInspection[];
  periodLabel: string;
  scopeLabel: string;
  generatedAt?: Date;
}

const PAGE_MARGIN = 40;
const PAGE_BOTTOM_MARGIN = 52;
const LINE_HEIGHT = 14;
const TABLE_CELL_PADDING_X = 6;
const TABLE_CELL_PADDING_Y = 5;
const TABLE_HEADER_HEIGHT = 24;
const TABLE_MIN_ROW_HEIGHT = 24;
const TABLE_COLUMN_WIDTHS = [64, 116, 118, 178] as const;

const formatInspectionDate = (value: string | null) => {
  if (!value) return "-";

  try {
    return format(parseISO(value), "dd/MM/yyyy", { locale: es });
  } catch {
    return value;
  }
};

const formatLongDate = (value: Date) =>
  format(value, "dd 'de' MMMM 'de' yyyy HH:mm", { locale: es });

const sanitizeFilePart = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "reporte";

const summarizeCounts = (entries: Array<[string, number]>, emptyLabel: string) => {
  if (entries.length === 0) return [emptyLabel];

  return entries.slice(0, 6).map(([label, count]) => `${label}: ${count}`);
};

const buildGroupedSummary = (
  inspections: DashboardReportInspection[],
  getKey: (inspection: DashboardReportInspection) => string,
) =>
  Object.entries(
    inspections.reduce<Record<string, number>>((accumulator, inspection) => {
      const key = getKey(inspection);
      accumulator[key] = (accumulator[key] ?? 0) + 1;
      return accumulator;
    }, {}),
  ).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "es"));

export const exportDashboardReportToPDF = ({
  inspections,
  periodLabel,
  scopeLabel,
  generatedAt = new Date(),
}: DashboardReportExportOptions) => {
  const doc = new jsPDF({
    unit: "pt",
    format: "a4",
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const usableWidth = pageWidth - PAGE_MARGIN * 2;
  let cursorY = PAGE_MARGIN;

  const ensureSpace = (requiredHeight: number) => {
    if (cursorY + requiredHeight <= pageHeight - PAGE_BOTTOM_MARGIN) return;

    doc.addPage();
    cursorY = PAGE_MARGIN;
  };

  const addWrappedText = (
    text: string,
    options: {
      size?: number;
      color?: [number, number, number];
      bold?: boolean;
      indent?: number;
      maxWidth?: number;
      spacingAfter?: number;
    } = {},
  ) => {
    const {
      size = 10,
      color = [31, 41, 55],
      bold = false,
      indent = 0,
      maxWidth = usableWidth - indent,
      spacingAfter = 8,
    } = options;
    const lines = doc.splitTextToSize(text || "-", maxWidth);
    const lineBlockHeight = Math.max(lines.length, 1) * LINE_HEIGHT;

    ensureSpace(lineBlockHeight);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(lines, PAGE_MARGIN + indent, cursorY);
    cursorY += lineBlockHeight + spacingAfter;
  };

  const addSectionTitle = (title: string) => {
    ensureSpace(28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(title, PAGE_MARGIN, cursorY);
    cursorY += 8;
    doc.setDrawColor(226, 232, 240);
    doc.line(PAGE_MARGIN, cursorY, pageWidth - PAGE_MARGIN, cursorY);
    cursorY += 14;
  };

  doc.setFillColor(37, 99, 235);
  doc.roundedRect(PAGE_MARGIN, cursorY, usableWidth, 78, 18, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text("Reporte general de inspecciones", PAGE_MARGIN + 18, cursorY + 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Inspecciones completadas del dashboard", PAGE_MARGIN + 18, cursorY + 46);
  doc.text(`Generado el ${formatLongDate(generatedAt)}`, PAGE_MARGIN + 18, cursorY + 62);
  cursorY += 102;

  addSectionTitle("Parametros");
  addWrappedText(`Periodo: ${periodLabel}`, { bold: true, spacingAfter: 4 });
  addWrappedText(`Usuarios: ${scopeLabel}`, { spacingAfter: 4 });
  addWrappedText(`Total de inspecciones incluidas: ${inspections.length}`, { spacingAfter: 2 });

  const uniqueUsersCount = new Set(inspections.map((inspection) => inspection.user_id)).size;
  const uniqueContractsCount = new Set(
    inspections.map((inspection) => inspection.contract_type || "-"),
  ).size;

  addSectionTitle("Resumen");
  addWrappedText(`Usuarios incluidos: ${uniqueUsersCount}`, { bold: true, spacingAfter: 4 });
  addWrappedText(`Contratos incluidos: ${uniqueContractsCount}`, { spacingAfter: 4 });
  addWrappedText(
    `Periodo cubierto: ${inspections.length > 0 ? formatInspectionDate(inspections[inspections.length - 1]?.inspection_date ?? null) : "-"} a ${inspections.length > 0 ? formatInspectionDate(inspections[0]?.inspection_date ?? null) : "-"}`,
    { spacingAfter: 2 },
  );

  addSectionTitle("Distribucion");
  const inspectionsByUser = summarizeCounts(
    buildGroupedSummary(inspections, (inspection) => inspection.creator_name || "Sin usuario"),
    "Sin usuarios disponibles",
  );
  const inspectionsByContract = summarizeCounts(
    buildGroupedSummary(inspections, (inspection) => inspection.contract_type || "Sin contrato"),
    "Sin contratos disponibles",
  );

  addWrappedText("Por usuario", { bold: true, spacingAfter: 4 });
  inspectionsByUser.forEach((line) => addWrappedText(line, { indent: 12, spacingAfter: 2 }));
  addWrappedText("Por contrato", { bold: true, spacingAfter: 4 });
  inspectionsByContract.forEach((line) => addWrappedText(line, { indent: 12, spacingAfter: 2 }));

  addSectionTitle("Detalle");

  const drawTableHeader = () => {
    ensureSpace(TABLE_HEADER_HEIGHT + 2);
    const headerY = cursorY;
    const headers = ["Fecha", "Usuario", "Contrato", "Asunto"];
    let cellX = PAGE_MARGIN;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);

    headers.forEach((header, index) => {
      const width = TABLE_COLUMN_WIDTHS[index];
      doc.setFillColor(241, 245, 249);
      doc.rect(cellX, headerY, width, TABLE_HEADER_HEIGHT, "F");
      doc.setDrawColor(203, 213, 225);
      doc.rect(cellX, headerY, width, TABLE_HEADER_HEIGHT);
      doc.text(header, cellX + TABLE_CELL_PADDING_X, headerY + 16);
      cellX += width;
    });

    cursorY += TABLE_HEADER_HEIGHT;
  };

  drawTableHeader();

  if (inspections.length === 0) {
    ensureSpace(32);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(
      "No se encontraron inspecciones completadas con los filtros seleccionados.",
      PAGE_MARGIN + TABLE_CELL_PADDING_X,
      cursorY + 18,
    );
    doc.setDrawColor(203, 213, 225);
    doc.rect(PAGE_MARGIN, cursorY, usableWidth, 30);
    cursorY += 30;
  } else {
    inspections.forEach((inspection) => {
      const rowValues = [
        formatInspectionDate(inspection.inspection_date),
        inspection.creator_name || "-",
        inspection.contract_type || "-",
        inspection.subject || "Sin asunto",
      ];
      const splitLines = rowValues.map((value, index) =>
        doc.splitTextToSize(value, TABLE_COLUMN_WIDTHS[index] - TABLE_CELL_PADDING_X * 2),
      );
      const rowHeight = Math.max(
        TABLE_MIN_ROW_HEIGHT,
        ...splitLines.map((lines) => lines.length * LINE_HEIGHT + TABLE_CELL_PADDING_Y * 2),
      );

      ensureSpace(rowHeight + 1);

      if (cursorY === PAGE_MARGIN) {
        drawTableHeader();
      }

      let cellX = PAGE_MARGIN;
      splitLines.forEach((lines, index) => {
        const width = TABLE_COLUMN_WIDTHS[index];
        doc.setDrawColor(226, 232, 240);
        doc.rect(cellX, cursorY, width, rowHeight);
        doc.setFont("helvetica", index === 0 ? "bold" : "normal");
        doc.setFontSize(9);
        doc.setTextColor(31, 41, 55);
        doc.text(
          lines,
          cellX + TABLE_CELL_PADDING_X,
          cursorY + TABLE_CELL_PADDING_Y + 9,
        );
        cellX += width;
      });

      cursorY += rowHeight;
    });
  }

  const fileName = `reporte-inspecciones-${sanitizeFilePart(periodLabel)}-${format(generatedAt, "yyyyMMdd-HHmm")}.pdf`;
  doc.save(fileName);
};
