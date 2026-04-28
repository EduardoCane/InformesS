import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Archive, ArchiveRestore, Eye, Loader2, Trash2 } from "lucide-react";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Header } from "@/components/layout/Header";
import { StatusBadge, ResultBadge } from "@/components/inspections/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Inspection } from "@/lib/types";
import { toast } from "sonner";

const Archived = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [inspectionToDelete, setInspectionToDelete] = useState<Inspection | null>(null);

  const fetchItems = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("inspections")
      .select("*")
      .eq("user_id", user!.id)
      .eq("status", "archived")
      .order("updated_at", { ascending: false });

    setLoading(false);

    if (error) {
      toast.error("Error al cargar");
      return;
    }

    setItems((data ?? []) as Inspection[]);
  };

  useEffect(() => {
    if (user) fetchItems();
  }, [user]);

  const handleRestore = async (id: string) => {
    const { error } = await supabase
      .from("inspections")
      .update({ status: "completed" })
      .eq("id", id);

    if (error) {
      toast.error("Error al restaurar");
      return;
    }

    toast.success("Inspeccion restaurada");
    fetchItems();
  };

  const handleDelete = async () => {
    if (!inspectionToDelete) return;

    const { id } = inspectionToDelete;
    setInspectionToDelete(null);

    const { error } = await supabase.from("inspections").delete().eq("id", id);

    if (error) {
      toast.error("Error al eliminar");
      return;
    }

    toast.success("Inspeccion eliminada");
    fetchItems();
  };

  return (
    <>
      <Header title="Archivadas" subtitle="Inspecciones archivadas" />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-4 py-6 animate-fade-in sm:px-6 sm:py-8">
          <Card className="shadow-soft-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">
                Archivo
                <Badge variant="secondary" className="ml-2">
                  {items.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Cargando...
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                    <Archive className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <h3 className="text-base font-semibold">Archivo vacio</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    No hay inspecciones archivadas.
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-3 p-4 md:hidden">
                    {items.map((item) => (
                      <ArchivedInspectionCard
                        key={item.id}
                        item={item}
                        onView={() => navigate(`/inspections/${item.id}`)}
                        onRestore={() => handleRestore(item.id)}
                        onDelete={() => setInspectionToDelete(item)}
                      />
                    ))}
                  </div>
                  <div className="hidden overflow-x-auto md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead>Fecha</TableHead>
                          <TableHead>Contrato</TableHead>
                          <TableHead>Asunto</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Resultado</TableHead>
                          <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item) => (
                          <TableRow key={item.id} className="hover:bg-muted/30">
                            <TableCell className="whitespace-nowrap text-sm">
                              {item.inspection_date
                                ? format(parseISO(item.inspection_date), "dd MMM yyyy", { locale: es })
                                : "-"}
                            </TableCell>
                            <TableCell className="text-sm font-medium">
                              {item.contract_type || "-"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {item.subject ?? item.personnel_in_charge ?? "-"}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={item.status} />
                            </TableCell>
                            <TableCell>
                              <ResultBadge result={item.result} />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => navigate(`/inspections/${item.id}`)}
                                  title="Ver"
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => handleRestore(item.id)}
                                  title="Restaurar"
                                >
                                  <ArchiveRestore className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => setInspectionToDelete(item)}
                                  title="Eliminar"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <ConfirmActionDialog
        open={Boolean(inspectionToDelete)}
        onOpenChange={(open) => {
          if (!open) setInspectionToDelete(null);
        }}
        title="Eliminar inspeccion archivada"
        description="La inspeccion archivada se eliminara definitivamente y no se podra recuperar."
        confirmLabel="Eliminar"
        confirmTone="destructive"
        onConfirm={handleDelete}
      />
    </>
  );
};

const ArchivedInspectionCard = ({
  item,
  onView,
  onRestore,
  onDelete,
}: {
  item: Inspection;
  onView: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) => (
  <div className="rounded-2xl border border-border bg-card p-4 shadow-soft-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{item.contract_type || "-"}</p>
        <p className="text-xs text-muted-foreground">
          {item.inspection_date
            ? format(parseISO(item.inspection_date), "dd MMM yyyy", { locale: es })
            : "-"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge status={item.status} />
        <ResultBadge result={item.result} />
      </div>
    </div>

    <p className="mt-3 text-sm text-muted-foreground">{item.subject ?? item.personnel_in_charge ?? "-"}</p>

    <div className="mt-4 flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={onView} className="flex-1 min-w-[96px]">
        <Eye className="mr-1.5 h-4 w-4" />
        Ver
      </Button>
      <Button size="sm" variant="outline" onClick={onRestore} className="flex-1 min-w-[96px]">
        <ArchiveRestore className="mr-1.5 h-4 w-4" />
        Restaurar
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onDelete}
        className="flex-1 min-w-[96px] text-destructive hover:text-destructive"
      >
        <Trash2 className="mr-1.5 h-4 w-4" />
        Eliminar
      </Button>
    </div>
  </div>
);

export default Archived;
