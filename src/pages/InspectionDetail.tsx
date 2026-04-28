import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import {
  ArrowLeft,
  FileDown,
  FileText,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { Header } from "@/components/layout/Header";
import { StatusBadge, ResultBadge } from "@/components/inspections/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { supabase } from "@/integrations/supabase/client";
import { exportToDOCX, exportToPDF } from "@/lib/exporters";
import {
  getInspectionImageSources,
  getInspectionFormatSections,
  getRepeatableGroupLabel,
  readInspectionFormatSnapshot,
} from "@/lib/reportTemplates";
import { Evidence, Inspection } from "@/lib/types";
import { toast } from "sonner";

const getEvidenceImageSource = (evidence: Evidence) =>
  evidence.image_url || evidence.image_data || "";

const getEvidenceLabel = (evidence: Evidence) => {
  if (!evidence.field_id) return "Imagen";
  if (typeof evidence.block_index === "number") {
    return `${evidence.field_id} - bloque ${evidence.block_index + 1}`;
  }

  return evidence.field_id;
};

const InspectionDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [evidences, setEvidences] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);

  useEffect(() => {
    const fetchInspection = async () => {
      if (!id) return;

      const [{ data: inspectionData }, { data: evidenceData }] = await Promise.all([
        supabase.from("inspections").select("*").eq("id", id).maybeSingle(),
        supabase.from("evidence").select("*").eq("inspection_id", id).order("created_at"),
      ]);

      setInspection(inspectionData as Inspection | null);
      setEvidences((evidenceData ?? []) as Evidence[]);
      setLoading(false);
    };

    fetchInspection();
  }, [id]);

  const formatSnapshot = useMemo(
    () =>
      inspection
        ? readInspectionFormatSnapshot(inspection.dynamic_fields, inspection.contract_type)
        : null,
    [inspection],
  );

  const formatSections = useMemo(
    () =>
      inspection && formatSnapshot
        ? getInspectionFormatSections(inspection.dynamic_fields, formatSnapshot.fields)
        : [],
    [inspection, formatSnapshot],
  );

  const handleExportPDF = async () => {
    if (!inspection) return;

    setExporting("pdf");

    try {
      await exportToPDF(inspection, evidences);
      toast.success("PDF generado");
    } catch (error) {
      toast.error("Error generando PDF");
      console.error(error);
    }

    setExporting(null);
  };

  const handleExportDOCX = async () => {
    if (!inspection) return;

    setExporting("docx");

    try {
      await exportToDOCX(inspection, evidences);
      toast.success("Word generado");
    } catch (error) {
      toast.error("Error generando Word");
      console.error(error);
    }

    setExporting(null);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!inspection) {
    return (
      <>
        <Header title="Inspeccion no encontrada" />
        <div className="p-8">
          <Button variant="outline" onClick={() => navigate("/")}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Volver
          </Button>
        </div>
      </>
    );
  }

  const contractName = formatSnapshot?.templateName || inspection.contract_type || "-";
  const subtitle = formatSnapshot?.formatName
    ? `${contractName} - ${formatSnapshot.formatName}`
    : contractName;

  return (
    <>
      <Header
        title="Reporte de inspeccion"
        subtitle={subtitle}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleExportDOCX} disabled={Boolean(exporting)}>
              {exporting === "docx" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-1.5 h-4 w-4" />
              )}
              Word
            </Button>
            <Button size="sm" onClick={handleExportPDF} disabled={Boolean(exporting)}>
              {exporting === "pdf" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="mr-1.5 h-4 w-4" />
              )}
              PDF
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 animate-fade-in sm:px-6 sm:py-8">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="-ml-2">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Volver
          </Button>

          <Card className="overflow-hidden shadow-soft-md">
            <div className="bg-gradient-primary px-4 py-5 text-primary-foreground sm:px-6">
              <p className="text-xs uppercase tracking-wider opacity-80">Reporte</p>
              <h2 className="mt-1 text-2xl font-semibold">{contractName}</h2>
              {formatSnapshot?.formatName && (
                <p className="mt-1 text-sm opacity-90">{formatSnapshot.formatName}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm opacity-90">
                <span>
                  {inspection.inspection_date
                    ? format(parseISO(inspection.inspection_date), "dd 'de' MMMM 'de' yyyy", {
                        locale: es,
                      })
                    : "Sin fecha"}
                </span>
                <span className="opacity-60">-</span>
                <span>{inspection.title ?? inspection.area ?? "Sin titulo"}</span>
              </div>
            </div>
            <CardContent className="flex flex-wrap gap-3 px-4 py-4 sm:px-6">
              <StatusBadge status={inspection.status} />
              <ResultBadge result={inspection.result} />
            </CardContent>
          </Card>

          <Card className="shadow-soft-sm">
            <CardHeader>
              <CardTitle className="text-sm">Datos generales</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <DataRow label="Titulo" value={inspection.title ?? inspection.area} />
              <DataRow label="Para" value={inspection.location} />
              <DataRow label="DE" value={inspection.specific_site} />
              <DataRow label="Fecha" value={inspection.inspection_date} />
              <DataRow label="Asunto" value={inspection.subject ?? inspection.personnel_in_charge} />
            </CardContent>
          </Card>

          <Card className="shadow-soft-sm">
            <CardHeader>
              <CardTitle className="text-sm">Formato aplicado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Contrato:</span>{" "}
                <strong>{contractName}</strong>
              </p>
              <p>
                <span className="text-muted-foreground">Formato:</span>{" "}
                <strong>{formatSnapshot?.formatName ?? "Sin formato guardado"}</strong>
              </p>
              {formatSnapshot?.formatDescription && (
                <p className="text-muted-foreground">{formatSnapshot.formatDescription}</p>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-soft-sm">
            <CardHeader>
              <CardTitle className="text-sm">Campos del formato</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {formatSections.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin campos especificos.</p>
              ) : (
                formatSections.map((section, sectionIndex) =>
                  section.type === "field" ? (
                    <div
                      key={`${section.field.id}-${sectionIndex}`}
                      className="flex flex-col gap-3 border-b border-border pb-3 last:border-0 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <span className="text-muted-foreground">{section.field.label}</span>
                      {section.field.type === "image" ? (
                        getInspectionImageSources(section.value).length > 0 ? (
                          <ImageGallery
                            images={getInspectionImageSources(section.value)}
                            label={section.field.label}
                          />
                        ) : (
                          <span className="text-right font-medium">Sin imagen</span>
                        )
                      ) : section.field.type === "textarea" ? (
                        <RichTextContent
                          value={section.value}
                          className="w-full max-w-xl rounded-lg border border-border bg-muted/20 px-3 py-2 text-left sm:ml-auto"
                        />
                      ) : (
                        <span className="text-right font-medium">
                          {String(section.value ?? "-") || "-"}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div
                      key={`${section.groupKey}-${sectionIndex}`}
                      className="space-y-3 border-b border-border pb-3 last:border-0"
                    >
                      <div>
                        <p className="font-medium">{getRepeatableGroupLabel(section.groupKey)}</p>
                        <p className="text-xs text-muted-foreground">
                          {section.blocks.length
                            ? `${section.blocks.length} bloque(s)`
                            : "Sin bloques registrados"}
                        </p>
                      </div>

                      {section.blocks.map((block) => (
                        <div key={`${section.groupKey}-${block.index}`} className="rounded-lg border border-border p-3">
                          <p className="mb-3 text-sm font-medium">Bloque {block.index}</p>
                          <div className="space-y-3">
                            {block.entries.map(({ field, value }) => (
                              <div
                                key={`${field.id}-${block.index}`}
                                className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
                              >
                                <span className="text-muted-foreground">{field.label}</span>
                                {field.type === "image" ? (
                                  getInspectionImageSources(value).length > 0 ? (
                                    <ImageGallery
                                      images={getInspectionImageSources(value)}
                                      label={field.label}
                                    />
                                  ) : (
                                    <span className="text-right font-medium">Sin imagen</span>
                                  )
                                ) : field.type === "textarea" ? (
                                  <RichTextContent
                                    value={value}
                                    className="w-full max-w-xl rounded-lg border border-border bg-muted/20 px-3 py-2 text-left sm:ml-auto"
                                  />
                                ) : (
                                  <span className="text-right font-medium">
                                    {String(value ?? "-") || "-"}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ),
                )
              )}
            </CardContent>
          </Card>

          <Card className="shadow-soft-sm">
            <CardHeader>
              <CardTitle className="text-sm">Evidencias ({evidences.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {evidences.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-muted-foreground">
                  <ImageIcon className="mb-2 h-8 w-8" />
                  <p className="text-sm">Sin evidencias adjuntas.</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {evidences.map((evidence) => (
                    <div key={evidence.id} className="overflow-hidden rounded-lg border border-border bg-card">
                      <div className="aspect-video bg-muted">
                        <img
                          src={getEvidenceImageSource(evidence)}
                          alt={getEvidenceLabel(evidence)}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="p-3">
                        <span className="inline-block rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                          {getEvidenceLabel(evidence)}
                        </span>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {evidence.created_at
                            ? format(parseISO(evidence.created_at), "dd MMM yyyy HH:mm", { locale: es })
                            : "Sin fecha"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-soft-sm">
            <CardHeader>
              <CardTitle className="text-sm">Conclusion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                Inspeccion correspondiente al contrato <strong>{contractName}</strong>
                {formatSnapshot?.formatName ? (
                  <>
                    {" "}
                    con el formato <strong>{formatSnapshot.formatName}</strong>
                  </>
                ) : null}
                , realizada el <strong>{inspection.inspection_date ?? "-"}</strong> con asunto{" "}
                <strong>{inspection.subject ?? inspection.personnel_in_charge ?? "-"}</strong>.
              </p>
              <p>
                Resultado:{" "}
                <strong
                  className={
                    inspection.result === "Cumple"
                      ? "text-success"
                      : inspection.result === "No cumple"
                        ? "text-destructive"
                        : ""
                  }
                >
                  {inspection.result ?? "Sin determinar"}
                </strong>
                . Se documentaron <strong>{evidences.length}</strong> evidencia(s).
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};

const DataRow = ({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) => (
  <div>
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-0.5 text-sm font-medium">{value || "-"}</p>
  </div>
);

const ImageGallery = ({
  images,
  label,
}: {
  images: string[];
  label: string;
}) => (
  <div className="grid w-full max-w-sm grid-cols-2 gap-2">
    {images.map((imageSource, index) => (
      <div key={`${label}-${index}`} className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="aspect-square bg-muted">
          <img
            src={imageSource}
            alt={`${label} ${index + 1}`}
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    ))}
  </div>
);

export default InspectionDetail;
