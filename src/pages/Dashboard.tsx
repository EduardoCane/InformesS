import { ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertCircle,
  Archive,
  CalendarRange,
  CheckCircle2,
  Clock,
  Eye,
  FileSearch,
  FileText,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Header } from "@/components/layout/Header";
import { StatusBadge } from "@/components/inspections/StatusBadge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { exportDashboardReportToPDF } from "@/lib/dashboardReportExport";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Stats {
  total: number;
  completed: number;
  thisMonth: number;
  pending: number;
}

interface DashboardInspection {
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

interface DashboardUserOption {
  id: string;
  display_name: string;
}

interface DashboardUsersRpcRow {
  id: string;
  display_name?: string | null;
  full_name?: string | null;
  email?: string | null;
}

type ReportRangeMode = "month" | "month-range" | "day-range";
type ReportUserMode = "mine" | "all" | "single" | "selected";

const OWNER_FILTER_MINE = "mine";
const OWNER_FILTER_ALL = "all";
const OWNER_FILTER_PREFIX = "user:";

const dashboardCache = new Map<string, DashboardInspection[]>();
const dashboardUsersCache = new Map<string, DashboardUserOption[]>();

const getDashboardCacheKey = (userId: string, ownerFilter: string) => `${userId}:${ownerFilter}`;

const getDashboardRpcFilter = (ownerFilter: string): "mine" | "all" | "by_user" => {
  if (ownerFilter === OWNER_FILTER_ALL) return "all";
  if (ownerFilter.startsWith(OWNER_FILTER_PREFIX)) return "by_user";
  return "mine";
};

const getDashboardTargetUserId = (ownerFilter: string) =>
  ownerFilter.startsWith(OWNER_FILTER_PREFIX) ? ownerFilter.slice(OWNER_FILTER_PREFIX.length) : null;

const isMissingRpcError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;

  const code = "code" in error ? String(error.code ?? "") : "";
  const message = "message" in error ? String(error.message ?? "") : "";

  return code === "PGRST202" || message.toLowerCase().includes("could not find the function");
};

const isUnauthorizedRpcError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;

  const message = "message" in error ? String(error.message ?? "") : "";

  return message.toLowerCase().includes("no autorizado");
};

const normalizeDashboardUsers = (rows: DashboardUsersRpcRow[]): DashboardUserOption[] =>
  rows.map((row) => ({
    id: row.id,
    display_name: row.display_name ?? row.full_name ?? row.email ?? row.id,
  }));

const getCurrentMonthValue = () => format(new Date(), "yyyy-MM");

const getCurrentDateValue = () => format(new Date(), "yyyy-MM-dd");

const getCurrentMonthStartDateValue = () => format(startOfMonth(new Date()), "yyyy-MM-dd");

const getMonthDateWindow = (value: string) => {
  if (!value) return null;

  const [rawYear, rawMonth] = value.split("-");
  const year = Number(rawYear);
  const month = Number(rawMonth);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  const monthDate = new Date(year, month - 1, 1);

  return {
    from: format(monthDate, "yyyy-MM-dd"),
    to: format(endOfMonth(monthDate), "yyyy-MM-dd"),
    label: format(monthDate, "MMMM yyyy", { locale: es }),
  };
};

const getReportDateWindow = ({
  mode,
  month,
  monthFrom,
  monthTo,
  dayFrom,
  dayTo,
}: {
  mode: ReportRangeMode;
  month: string;
  monthFrom: string;
  monthTo: string;
  dayFrom: string;
  dayTo: string;
}) => {
  if (mode === "month") {
    const monthWindow = getMonthDateWindow(month);

    if (!monthWindow) {
      return {
        from: "",
        to: "",
        label: "",
        error: "Selecciona un mes valido para generar el reporte.",
      };
    }

    return {
      ...monthWindow,
      error: null,
    };
  }

  if (mode === "month-range") {
    const startWindow = getMonthDateWindow(monthFrom);
    const endWindow = getMonthDateWindow(monthTo);

    if (!startWindow || !endWindow) {
      return {
        from: "",
        to: "",
        label: "",
        error: "Selecciona el intervalo de meses completo.",
      };
    }

    if (startWindow.from > endWindow.from) {
      return {
        from: "",
        to: "",
        label: "",
        error: "El mes inicial no puede ser mayor al mes final.",
      };
    }

    return {
      from: startWindow.from,
      to: endWindow.to,
      label: `${startWindow.label} a ${endWindow.label}`,
      error: null,
    };
  }

  if (!dayFrom || !dayTo) {
    return {
      from: "",
      to: "",
      label: "",
      error: "Selecciona el rango de dias completo.",
    };
  }

  if (dayFrom > dayTo) {
    return {
      from: "",
      to: "",
      label: "",
      error: "La fecha desde no puede ser mayor a la fecha hasta.",
    };
  }

  return {
    from: dayFrom,
    to: dayTo,
    label: `${format(parseISO(dayFrom), "dd MMM yyyy", { locale: es })} a ${format(parseISO(dayTo), "dd MMM yyyy", { locale: es })}`,
    error: null,
  };
};

const filterReportInspections = ({
  inspections,
  dateFrom,
  dateTo,
  selectedUserIds,
}: {
  inspections: DashboardInspection[];
  dateFrom: string;
  dateTo: string;
  selectedUserIds: Set<string> | null;
}) =>
  inspections
    .filter((inspection) => {
      if (inspection.status !== "completed") return false;
      if (!inspection.inspection_date) return false;
      if (inspection.inspection_date < dateFrom) return false;
      if (inspection.inspection_date > dateTo) return false;
      if (selectedUserIds && !selectedUserIds.has(inspection.user_id)) return false;

      return true;
    })
    .sort((left, right) => {
      const dateComparison = (right.inspection_date ?? "").localeCompare(left.inspection_date ?? "");

      if (dateComparison !== 0) return dateComparison;

      return right.created_at.localeCompare(left.created_at);
    });

const summarizeSelectedUsers = (users: DashboardUserOption[]) => {
  if (users.length === 0) return "Sin usuarios seleccionados";
  if (users.length <= 3) return users.map((user) => user.display_name).join(", ");

  return `${users.slice(0, 3).map((user) => user.display_name).join(", ")} +${users.length - 3}`;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [inspections, setInspections] = useState<DashboardInspection[]>([]);
  const [ownerFilter, setOwnerFilter] = useState(OWNER_FILTER_MINE);
  const [availableUsers, setAvailableUsers] = useState<DashboardUserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [contractFilter, setContractFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [inspectionToDelete, setInspectionToDelete] = useState<DashboardInspection | null>(null);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportRangeMode, setReportRangeMode] = useState<ReportRangeMode>("month");
  const [reportMonth, setReportMonth] = useState(getCurrentMonthValue);
  const [reportMonthFrom, setReportMonthFrom] = useState(getCurrentMonthValue);
  const [reportMonthTo, setReportMonthTo] = useState(getCurrentMonthValue);
  const [reportDayFrom, setReportDayFrom] = useState(getCurrentMonthStartDateValue);
  const [reportDayTo, setReportDayTo] = useState(getCurrentDateValue);
  const [reportUserMode, setReportUserMode] = useState<ReportUserMode>("mine");
  const [reportSingleUserId, setReportSingleUserId] = useState("");
  const [reportSelectedUserIds, setReportSelectedUserIds] = useState<string[]>([]);
  const [reportSourceInspections, setReportSourceInspections] = useState<DashboardInspection[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportExporting, setReportExporting] = useState(false);
  const [deletingInspectionId, setDeletingInspectionId] = useState<string | null>(null);

  const isMineView = ownerFilter === OWNER_FILTER_MINE;
  const showCreatorColumn = !isMineView;
  const selectedOwnerId = getDashboardTargetUserId(ownerFilter);
  const selectedOwnerName = useMemo(
    () => availableUsers.find((option) => option.id === selectedOwnerId)?.display_name ?? null,
    [availableUsers, selectedOwnerId],
  );
  const filterableUsers = useMemo(
    () => availableUsers.filter((option) => option.id !== user?.id),
    [availableUsers, user?.id],
  );
  const reportSelectedUsers = useMemo(
    () => availableUsers.filter((option) => reportSelectedUserIds.includes(option.id)),
    [availableUsers, reportSelectedUserIds],
  );

  const syncInspections = useCallback((nextInspections: DashboardInspection[]) => {
    setInspections(nextInspections);

    if (user) {
      dashboardCache.set(getDashboardCacheKey(user.id, ownerFilter), nextInspections);
    }
  }, [ownerFilter, user]);

  const loadDashboardUsers = useCallback(async () => {
    if (!user) {
      return [];
    }

    if (dashboardUsersCache.has(user.id)) {
      return dashboardUsersCache.get(user.id) ?? [];
    }

    let response = await supabase.rpc("get_users_for_filter");

    if (response.error && isMissingRpcError(response.error)) {
      response = await supabase.rpc("dashboard_users");
    }

    if (response.error) {
      if (isUnauthorizedRpcError(response.error)) {
        console.warn("Dashboard users RPC not authorized for current user", response.error);
        return [];
      }

      throw response.error;
    }

    const nextUsers = normalizeDashboardUsers((response.data ?? []) as DashboardUsersRpcRow[]);
    dashboardUsersCache.set(user.id, nextUsers);
    return nextUsers;
  }, [user]);

  const fetchDashboardUsers = useCallback(async () => {
    try {
      const nextUsers = await loadDashboardUsers();
      setAvailableUsers(nextUsers);
      return nextUsers;
    } catch (error) {
      toast.error("Error al cargar usuarios");
      console.error("Error fetching dashboard users:", error);
      setAvailableUsers([]);
      return [];
    }
  }, [loadDashboardUsers]);

  const loadInspectionsForOwnerFilter = useCallback(async (targetOwnerFilter: string, skipCache = false) => {
    if (!user) {
      return [];
    }

    const cacheKey = getDashboardCacheKey(user.id, targetOwnerFilter);

    if (!skipCache && dashboardCache.has(cacheKey)) {
      return dashboardCache.get(cacheKey) ?? [];
    }

    let response = await supabase.rpc("get_inspections_dashboard", {
      p_filter: getDashboardRpcFilter(targetOwnerFilter),
      p_user_id: getDashboardTargetUserId(targetOwnerFilter),
    });

    if (response.error && isMissingRpcError(response.error)) {
      response = await supabase.rpc("dashboard_inspections", {
        p_scope:
          targetOwnerFilter === OWNER_FILTER_ALL
            ? "all"
            : targetOwnerFilter.startsWith(OWNER_FILTER_PREFIX)
              ? "user"
              : "mine",
        p_target_user_id: getDashboardTargetUserId(targetOwnerFilter),
      });
    }

    if (response.error) {
      throw response.error;
    }

    const nextInspections = (response.data ?? []) as DashboardInspection[];
    dashboardCache.set(cacheKey, nextInspections);
    return nextInspections;
  }, [user]);

  const fetchInspections = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    try {
      console.log("[Dashboard] Usuario actual:", user);
      if (!user) {
        console.warn("No user found, skipping fetch.");
        setInspections([]);
        setLoading(false);
        return;
      }

      const nextInspections = await loadInspectionsForOwnerFilter(ownerFilter, forceRefresh);
      syncInspections(nextInspections);
    } catch (err) {
      console.log("[Dashboard] Error al consultar inspections:", err);

      if (isUnauthorizedRpcError(err) && ownerFilter !== OWNER_FILTER_MINE) {
        toast.error("No tienes permisos para ver inspecciones de otros usuarios");
        setOwnerFilter(OWNER_FILTER_MINE);
        setInspections([]);
      } else {
        toast.error("Error al cargar inspecciones");
        console.error("Unexpected error fetching inspections:", err);
        setInspections([]);
      }
    } finally {
      setLoading(false);
    }
  }, [loadInspectionsForOwnerFilter, ownerFilter, syncInspections, user]);

  // Ya no se actualiza automáticamente al cambiar de pestaña

  useEffect(() => {
    if (!user) {
      setInspections([]);
      setAvailableUsers([]);
      setLoading(false);
      return;
    }

    const cacheKey = getDashboardCacheKey(user.id, ownerFilter);

    if (dashboardCache.has(cacheKey)) {
      setInspections(dashboardCache.get(cacheKey) ?? []);
      setLoading(false);
    } else {
      void fetchInspections();
    }
  }, [fetchInspections, ownerFilter, user]);

  const reportBaseOwnerFilter = useMemo(() => {
    if (reportUserMode === "mine") return OWNER_FILTER_MINE;
    if (reportUserMode === "all" || reportUserMode === "selected") return OWNER_FILTER_ALL;

    return reportSingleUserId ? `${OWNER_FILTER_PREFIX}${reportSingleUserId}` : null;
  }, [reportSingleUserId, reportUserMode]);

  const reportDateWindow = useMemo(
    () =>
      getReportDateWindow({
        mode: reportRangeMode,
        month: reportMonth,
        monthFrom: reportMonthFrom,
        monthTo: reportMonthTo,
        dayFrom: reportDayFrom,
        dayTo: reportDayTo,
      }),
    [reportDayFrom, reportDayTo, reportMonth, reportMonthFrom, reportMonthTo, reportRangeMode],
  );

  const reportSelectedUserIdSet = useMemo(
    () => (reportUserMode === "selected" ? new Set(reportSelectedUserIds) : null),
    [reportSelectedUserIds, reportUserMode],
  );

  const reportFilteredInspections = useMemo(() => {
    if (reportDateWindow.error || !reportDateWindow.from || !reportDateWindow.to) {
      return [];
    }

    return filterReportInspections({
      inspections: reportSourceInspections,
      dateFrom: reportDateWindow.from,
      dateTo: reportDateWindow.to,
      selectedUserIds: reportSelectedUserIdSet,
    });
  }, [reportDateWindow, reportSelectedUserIdSet, reportSourceInspections]);

  const reportValidationError = useMemo(() => {
    if (reportDateWindow.error) return reportDateWindow.error;

    if (reportUserMode === "single" && !reportSingleUserId) {
      return "Selecciona un usuario para generar el reporte.";
    }

    if (reportUserMode === "selected" && reportSelectedUserIds.length === 0) {
      return "Selecciona al menos un usuario para el reporte general.";
    }

    return null;
  }, [reportDateWindow.error, reportSelectedUserIds.length, reportSingleUserId, reportUserMode]);

  const reportScopeLabel = useMemo(() => {
    if (reportUserMode === "mine") return "Mis inspecciones";
    if (reportUserMode === "all") return "Todos los usuarios";
    if (reportUserMode === "single") {
      return availableUsers.find((option) => option.id === reportSingleUserId)?.display_name ?? "Usuario especifico";
    }

    return `Usuarios seleccionados: ${summarizeSelectedUsers(reportSelectedUsers)}`;
  }, [availableUsers, reportSelectedUsers, reportSingleUserId, reportUserMode]);

  const reportPreviewUsersCount = useMemo(
    () => new Set(reportFilteredInspections.map((inspection) => inspection.user_id)).size,
    [reportFilteredInspections],
  );
  const reportPreviewContractsCount = useMemo(
    () =>
      new Set(
        reportFilteredInspections.map((inspection) => inspection.contract_type || "-"),
      ).size,
    [reportFilteredInspections],
  );

  useEffect(() => {
    if (!user) {
      setReportSourceInspections([]);
      setReportLoading(false);
      return;
    }
  }, [user]);

  useEffect(() => {
    if (!isReportDialogOpen) return;

    void fetchDashboardUsers();
  }, [fetchDashboardUsers, isReportDialogOpen]);

  useEffect(() => {
    if (availableUsers.length === 0) return;

    if (reportSingleUserId && !availableUsers.some((option) => option.id === reportSingleUserId)) {
      setReportSingleUserId("");
    }

    setReportSelectedUserIds((currentIds) =>
      currentIds.filter((currentId) => availableUsers.some((option) => option.id === currentId)),
    );
  }, [availableUsers, reportSingleUserId]);

  useEffect(() => {
    if (!isReportDialogOpen || !user) return;
    if (!reportBaseOwnerFilter) {
      setReportSourceInspections([]);
      return;
    }

    let cancelled = false;

    setReportLoading(true);

    void loadInspectionsForOwnerFilter(reportBaseOwnerFilter)
      .then((nextInspections) => {
        if (cancelled) return;
        setReportSourceInspections(nextInspections);
      })
      .catch((error) => {
        if (cancelled) return;

        setReportSourceInspections([]);

        if (isUnauthorizedRpcError(error) && reportUserMode !== "mine") {
          toast.error("No tienes permisos para generar reportes de otros usuarios");
          setReportUserMode("mine");
          return;
        }

        toast.error("Error al preparar los datos del reporte");
        console.error("Error loading report inspections:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setReportLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isReportDialogOpen, loadInspectionsForOwnerFilter, reportBaseOwnerFilter, reportUserMode, user]);

  const contractOptions = useMemo(
    () =>
      Array.from(
        new Set(
          inspections
            .map((inspection) => inspection.contract_type)
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [inspections],
  );

  useEffect(() => {
    if (contractFilter !== "all" && !contractOptions.includes(contractFilter)) {
      setContractFilter("all");
    }
  }, [contractFilter, contractOptions]);

  const filteredInspections = useMemo(
    () =>
      inspections.filter((inspection) => {
        if (contractFilter !== "all" && inspection.contract_type !== contractFilter) return false;
        if (statusFilter !== "all" && inspection.status !== statusFilter) return false;
        if (dateFrom && inspection.inspection_date && inspection.inspection_date < dateFrom) return false;
        if (dateTo && inspection.inspection_date && inspection.inspection_date > dateTo) return false;

        return true;
      }),
    [inspections, contractFilter, statusFilter, dateFrom, dateTo],
  );

  const hasActiveFilters =
    ownerFilter !== OWNER_FILTER_MINE ||
    contractFilter !== "all" ||
    statusFilter !== "all" ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const stats: Stats = useMemo(() => {
    const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");

    return {
      total: inspections.length,
      completed: inspections.filter((inspection) => inspection.status === "completed").length,
      pending: inspections.filter((inspection) =>
        inspection.status === "pending" || inspection.status === "draft",
      ).length,
      thisMonth: inspections.filter(
        (inspection) => inspection.inspection_date && inspection.inspection_date >= monthStart,
      ).length,
    };
  }, [inspections]);

  const visibleSummary = hasActiveFilters
    ? `Mostrando ${filteredInspections.length} de ${inspections.length} inspecciones`
    : `${inspections.length} inspeccion${inspections.length === 1 ? "" : "es"} disponible${
        inspections.length === 1 ? "" : "s"
      }`;
  const visibleSummaryWithOwner =
    ownerFilter === OWNER_FILTER_ALL
      ? `${visibleSummary} de todos los usuarios`
      : selectedOwnerName
        ? `${visibleSummary} de ${selectedOwnerName}`
        : visibleSummary;

  const handleArchive = async (id: string) => {
    const { error } = await supabase
      .from("inspections")
      .update({ status: "archived" })
      .eq("id", id);

    if (error) {
      toast.error("Error al archivar");
      return;
    }

    toast.success("Inspeccion archivada");
    // Limpiar caché y recargar
    dashboardCache.clear();
    void fetchInspections();
  };

  const handleDelete = async () => {
    if (!inspectionToDelete) return;

    const { id } = inspectionToDelete;
    setDeletingInspectionId(id);

    const { error } = await supabase.from("inspections").delete().eq("id", id);

    setDeletingInspectionId(null);

    if (error) {
      toast.error("Error al eliminar");
      return;
    }

    toast.success("Inspeccion eliminada");
    setInspectionToDelete(null);
    // Limpiar caché y recargar
    dashboardCache.clear();
    void fetchInspections();
  };

  const openReportDialog = () => {
    if (ownerFilter === OWNER_FILTER_ALL) {
      setReportUserMode("all");
    } else if (ownerFilter.startsWith(OWNER_FILTER_PREFIX)) {
      setReportUserMode("single");
      setReportSingleUserId(selectedOwnerId ?? "");
    } else {
      setReportUserMode("mine");
    }

    setIsReportDialogOpen(true);
  };

  const handleToggleReportUser = (userId: string, checked: boolean) => {
    setReportSelectedUserIds((currentIds) => {
      if (checked) {
        return currentIds.includes(userId) ? currentIds : [...currentIds, userId];
      }

      return currentIds.filter((currentId) => currentId !== userId);
    });
  };

  const handleGenerateReport = async () => {
    if (reportValidationError) {
      toast.error(reportValidationError);
      return;
    }

    if (reportLoading) {
      toast.error("Espera a que termine la carga del reporte.");
      return;
    }

    if (reportFilteredInspections.length === 0) {
      toast.error("No hay inspecciones completadas con esos filtros.");
      return;
    }

    setReportExporting(true);

    try {
      exportDashboardReportToPDF({
        inspections: reportFilteredInspections,
        periodLabel: reportDateWindow.label,
        scopeLabel: reportScopeLabel,
      });
      toast.success("Reporte generado");
      setIsReportDialogOpen(false);
    } catch (error) {
      toast.error("Error al generar el reporte");
      console.error("Error exporting dashboard report:", error);
    } finally {
      setReportExporting(false);
    }
  };

  return (
    <>
      <Header
        title="Dashboard"
        subtitle="Resumen de inspecciones de campo"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={openReportDialog}>
              <FileText className="mr-1.5 h-4 w-4" />
              Crear reporte
            </Button>
            <Button size="sm" onClick={() => navigate("/inspections/new")}>
              <Plus className="mr-1.5 h-4 w-4" />
              Nueva inspeccion
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 animate-fade-in sm:px-6 sm:py-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={FileSearch} label="Total inspecciones" value={stats.total} tone="primary" />
            <StatCard icon={CheckCircle2} label="Completadas" value={stats.completed} tone="success" />
            <StatCard icon={CalendarRange} label="Este mes" value={stats.thisMonth} tone="info" />
            <StatCard icon={Clock} label="Pendientes" value={stats.pending} tone="warning" />
          </div>

          <Card className="shadow-soft-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Filtros</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                <div className="space-y-1.5">
                  <Label className="text-xs">Usuario</Label>
                  <Select
                    value={ownerFilter}
                    onValueChange={setOwnerFilter}
                    onOpenChange={(open) => {
                      if (open) {
                        void fetchDashboardUsers();
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={OWNER_FILTER_MINE}>Mis inspecciones</SelectItem>
                      <SelectItem value={OWNER_FILTER_ALL}>Todos los usuarios</SelectItem>
                      {filterableUsers.map((option) => (
                        <SelectItem key={option.id} value={`${OWNER_FILTER_PREFIX}${option.id}`}>
                          {option.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Contrato</Label>
                  <Select value={contractFilter} onValueChange={setContractFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {contractOptions.map((contractName) => (
                        <SelectItem key={contractName} value={contractName}>
                          {contractName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Estado</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="draft">Borrador</SelectItem>
                      <SelectItem value="pending">Pendiente</SelectItem>
                      <SelectItem value="in_progress">En proceso</SelectItem>
                      <SelectItem value="completed">Completada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Desde</Label>
                  <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Hasta</Label>
                  <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-border/60 bg-card/95 shadow-soft-md">
            <CardHeader className="gap-4 border-b border-border/60 bg-gradient-to-r from-primary-muted/80 via-background to-background p-4 sm:p-6 md:flex-row md:items-center md:justify-between md:space-y-0">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <CardTitle className="text-lg font-semibold text-foreground">Inspecciones</CardTitle>
                  <Badge
                    variant="secondary"
                    className="rounded-full bg-background/90 px-3 py-1 text-xs font-semibold shadow-soft-sm"
                  >
                    {filteredInspections.length}
                  </Badge>
                  {hasActiveFilters ? (
                    <Badge
                      variant="outline"
                      className="rounded-full border-primary/20 bg-primary-muted/70 px-3 py-1 text-xs font-medium text-primary"
                    >
                      Filtros activos
                    </Badge>
                  ) : null}
                </div>
                <CardDescription className="max-w-2xl text-sm leading-6">
                  {visibleSummaryWithOwner}. Los cambios solo se consultan cuando presionas refrescar.
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => fetchInspections(true)}
                disabled={loading}
                className="h-10 rounded-full border-border/70 bg-background/90 px-4 shadow-soft-sm hover:bg-background"
              >
                <Loader2 className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
                Refrescar
              </Button>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              {loading ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center rounded-3xl border border-dashed border-border/70 bg-gradient-to-br from-muted/60 via-background to-background px-6 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <p className="mt-4 text-sm font-medium text-foreground">Actualizando inspecciones</p>
                  <p className="mt-1 max-w-md text-sm text-muted-foreground">
                    El panel conserva los datos mientras navegas y solo se sincroniza cuando lo indicas.
                  </p>
                </div>
              ) : filteredInspections.length === 0 ? (
                <EmptyState onCreate={() => navigate("/inspections/new")} />
              ) : (
                <>
                <div className="space-y-3 md:hidden">
                  {filteredInspections.map((inspection) => (
                    <DashboardInspectionCard
                      key={inspection.id}
                      inspection={inspection}
                      showCreator={showCreatorColumn}
                      canArchive={inspection.user_id === user?.id}
                      onView={() => navigate(`/inspections/${inspection.id}`)}
                      onArchive={() => handleArchive(inspection.id)}
                      onDelete={() => setInspectionToDelete(inspection)}
                    />
                  ))}
                </div>
                <div className="hidden overflow-hidden rounded-3xl border border-border/70 bg-background shadow-soft-sm md:block">
                  <div className="overflow-x-auto">
                      <Table className={cn("min-w-[760px]", showCreatorColumn && "min-w-[940px]")}>
                        <TableHeader>
                          <TableRow className="border-border/70 bg-muted/45 hover:bg-muted/45">
                            <TableHead className="w-[18%] px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Fecha
                            </TableHead>
                            {showCreatorColumn ? (
                              <TableHead className="w-[20%] px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                Usuario
                              </TableHead>
                            ) : null}
                            <TableHead className="w-[22%] px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Contrato
                            </TableHead>
                            <TableHead className="w-[28%] px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Asunto
                            </TableHead>
                            <TableHead className="w-[14%] px-6 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Estado
                            </TableHead>
                            <TableHead className="w-[16%] px-6 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Acciones
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredInspections.map((inspection) => {
                            const canArchive = inspection.user_id === user?.id;

                            return (
                              <TableRow
                                key={inspection.id}
                                className="group border-border/60 bg-background transition-colors hover:bg-primary-muted/25"
                              >
                                <TableCell className="px-6 py-5">
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-muted text-primary">
                                      <CalendarRange className="h-4 w-4" />
                                    </div>
                                    <div className="space-y-0.5">
                                      <p className="text-sm font-semibold text-foreground">
                                        {inspection.inspection_date
                                          ? format(parseISO(inspection.inspection_date), "dd MMM yyyy", { locale: es })
                                          : "-"}
                                      </p>
                                      <p className="text-xs text-muted-foreground">Fecha programada</p>
                                    </div>
                                  </div>
                                </TableCell>
                                {showCreatorColumn ? (
                                  <TableCell className="px-6 py-5 text-sm text-muted-foreground">
                                    {inspection.creator_name ?? "-"}
                                  </TableCell>
                                ) : null}
                                <TableCell className="px-6 py-5 text-sm font-semibold text-foreground">
                                  {inspection.contract_type || "-"}
                                </TableCell>
                                <TableCell className="px-6 py-5">
                                  <p className="max-w-[22rem] truncate text-sm text-muted-foreground">
                                    {inspection.subject ?? "Sin asunto"}
                                  </p>
                                </TableCell>
                                <TableCell className="px-6 py-5">
                                  <StatusBadge status={inspection.status} />
                                </TableCell>
                                <TableCell className="px-6 py-5">
                                  <div className="flex items-center justify-end gap-2">
                                    <TableActionButton
                                      icon={Eye}
                                      title="Ver"
                                      onClick={() => navigate(`/inspections/${inspection.id}`)}
                                    />
                                    {canArchive ? (
                                      <TableActionButton
                                        icon={Archive}
                                        title="Archivar"
                                        tone="warning"
                                        onClick={() => handleArchive(inspection.id)}
                                      />
                                    ) : null}
                                    <TableActionButton
                                      icon={Trash2}
                                      title="Eliminar"
                                      tone="danger"
                                      onClick={() => setInspectionToDelete(inspection)}
                                    />
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <DashboardReportDialog
        open={isReportDialogOpen}
        onOpenChange={setIsReportDialogOpen}
        rangeMode={reportRangeMode}
        onRangeModeChange={setReportRangeMode}
        month={reportMonth}
        onMonthChange={setReportMonth}
        monthFrom={reportMonthFrom}
        onMonthFromChange={setReportMonthFrom}
        monthTo={reportMonthTo}
        onMonthToChange={setReportMonthTo}
        dayFrom={reportDayFrom}
        onDayFromChange={setReportDayFrom}
        dayTo={reportDayTo}
        onDayToChange={setReportDayTo}
        userMode={reportUserMode}
        onUserModeChange={setReportUserMode}
        singleUserId={reportSingleUserId}
        onSingleUserIdChange={setReportSingleUserId}
        selectedUserIds={reportSelectedUserIds}
        onToggleSelectedUser={handleToggleReportUser}
        onSelectAllUsers={() => setReportSelectedUserIds(availableUsers.map((option) => option.id))}
        onClearSelectedUsers={() => setReportSelectedUserIds([])}
        users={availableUsers}
        loading={reportLoading}
        exporting={reportExporting}
        validationError={reportValidationError}
        periodLabel={reportDateWindow.label}
        scopeLabel={reportScopeLabel}
        inspectionCount={reportFilteredInspections.length}
        usersCount={reportPreviewUsersCount}
        contractsCount={reportPreviewContractsCount}
        onGenerate={handleGenerateReport}
      />
      <ConfirmActionDialog
        open={Boolean(inspectionToDelete)}
        onOpenChange={(open) => {
          if (!open) setInspectionToDelete(null);
        }}
        title="Eliminar inspeccion"
        description="Esta accion no se puede deshacer. La inspeccion se eliminara de forma permanente."
        confirmLabel="Eliminar"
        confirmTone="destructive"
        onConfirm={handleDelete}
        loading={deletingInspectionId !== null}
      />
    </>
  );
};

const DashboardReportDialog = ({
  open,
  onOpenChange,
  rangeMode,
  onRangeModeChange,
  month,
  onMonthChange,
  monthFrom,
  onMonthFromChange,
  monthTo,
  onMonthToChange,
  dayFrom,
  onDayFromChange,
  dayTo,
  onDayToChange,
  userMode,
  onUserModeChange,
  singleUserId,
  onSingleUserIdChange,
  selectedUserIds,
  onToggleSelectedUser,
  onSelectAllUsers,
  onClearSelectedUsers,
  users,
  loading,
  exporting,
  validationError,
  periodLabel,
  scopeLabel,
  inspectionCount,
  usersCount,
  contractsCount,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rangeMode: ReportRangeMode;
  onRangeModeChange: (value: ReportRangeMode) => void;
  month: string;
  onMonthChange: (value: string) => void;
  monthFrom: string;
  onMonthFromChange: (value: string) => void;
  monthTo: string;
  onMonthToChange: (value: string) => void;
  dayFrom: string;
  onDayFromChange: (value: string) => void;
  dayTo: string;
  onDayToChange: (value: string) => void;
  userMode: ReportUserMode;
  onUserModeChange: (value: ReportUserMode) => void;
  singleUserId: string;
  onSingleUserIdChange: (value: string) => void;
  selectedUserIds: string[];
  onToggleSelectedUser: (userId: string, checked: boolean) => void;
  onSelectAllUsers: () => void;
  onClearSelectedUsers: () => void;
  users: DashboardUserOption[];
  loading: boolean;
  exporting: boolean;
  validationError: string | null;
  periodLabel: string;
  scopeLabel: string;
  inspectionCount: number;
  usersCount: number;
  contractsCount: number;
  onGenerate: () => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] max-w-full overflow-hidden p-0 sm:max-w-xl md:max-w-2xl lg:max-w-4xl flex flex-col">
      <DialogHeader className="border-b border-border/60 bg-gradient-to-r from-primary-muted/70 via-background to-background px-4 py-4 sm:px-6 sm:py-5 flex-shrink-0">
        <DialogTitle className="text-lg sm:text-xl">Crear reporte</DialogTitle>
        <DialogDescription className="text-xs sm:text-sm">
          Genera un PDF consolidado con las inspecciones completadas segun el periodo y los usuarios seleccionados.
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6 md:flex-row lg:gap-6">
        <div className="w-full space-y-6 md:min-w-0 md:flex-1">
          <Alert className="border-primary/15 bg-primary-muted/35">
            <AlertCircle className="h-4 w-4 text-primary" />
            <AlertDescription className="text-sm text-foreground">
              El reporte considera solo inspecciones completadas y no archivadas.
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">Periodo</Label>
            <div className="flex flex-wrap gap-2">
              <ModeChip
                active={rangeMode === "month"}
                onClick={() => onRangeModeChange("month")}
                label="Un mes"
              />
              <ModeChip
                active={rangeMode === "month-range"}
                onClick={() => onRangeModeChange("month-range")}
                label="Intervalo de meses"
              />
              <ModeChip
                active={rangeMode === "day-range"}
                onClick={() => onRangeModeChange("day-range")}
                label="Intervalo de dias"
              />
            </div>

            {rangeMode === "month" ? (
              <div className="space-y-1.5">
                <Label className="text-xs sm:text-xs">Mes</Label>
                <Input type="month" value={month} onChange={(event) => onMonthChange(event.target.value)} className="text-xs sm:text-sm" />
              </div>
            ) : null}

            {rangeMode === "month-range" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs sm:text-xs">Mes inicial</Label>
                  <Input type="month" value={monthFrom} onChange={(event) => onMonthFromChange(event.target.value)} className="text-xs sm:text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs sm:text-xs">Mes final</Label>
                  <Input type="month" value={monthTo} onChange={(event) => onMonthToChange(event.target.value)} className="text-xs sm:text-sm" />
                </div>
              </div>
            ) : null}

            {rangeMode === "day-range" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs sm:text-xs">Desde</Label>
                  <Input type="date" value={dayFrom} onChange={(event) => onDayFromChange(event.target.value)} className="text-xs sm:text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs sm:text-xs">Hasta</Label>
                  <Input type="date" value={dayTo} onChange={(event) => onDayToChange(event.target.value)} className="text-xs sm:text-sm" />
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">Usuarios</Label>
            <div className="flex flex-wrap gap-2">
              <ModeChip
                active={userMode === "mine"}
                onClick={() => onUserModeChange("mine")}
                label="Mis inspecciones"
              />
              <ModeChip
                active={userMode === "all"}
                onClick={() => onUserModeChange("all")}
                label="Todos"
              />
              <ModeChip
                active={userMode === "single"}
                onClick={() => onUserModeChange("single")}
                label="Usuario especifico"
              />
              <ModeChip
                active={userMode === "selected"}
                onClick={() => onUserModeChange("selected")}
                label="Usuarios elegidos"
              />
            </div>

            {userMode === "single" ? (
              <div className="space-y-1.5">
                <Label className="text-xs sm:text-xs">Usuario</Label>
                <Select value={singleUserId} onValueChange={onSingleUserIdChange}>
                  <SelectTrigger className="text-xs sm:text-sm">
                    <SelectValue placeholder="Selecciona un usuario" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {userMode === "selected" ? (
              <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground sm:text-sm">
                    {selectedUserIds.length} usuario{selectedUserIds.length === 1 ? "" : "s"} seleccionado
                  </p>
                  <div className="flex gap-1 sm:gap-2">
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] sm:h-8 sm:px-3 sm:text-xs" onClick={onSelectAllUsers}>
                      Seleccionar todos
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px] sm:h-8 sm:px-3 sm:text-xs" onClick={onClearSelectedUsers}>
                      Limpiar
                    </Button>
                  </div>
                </div>

                <ScrollArea className="h-48 rounded-xl border border-border/70 bg-background">
                  <div className="space-y-2 p-2 sm:p-3">
                    {users.length === 0 ? (
                      <p className="text-xs text-muted-foreground sm:text-sm">No hay usuarios disponibles para este reporte.</p>
                    ) : (
                      users.map((option) => {
                        const checked = selectedUserIds.includes(option.id);

                        return (
                          <label
                            key={option.id}
                            className="flex cursor-pointer items-center gap-2 rounded-xl border border-border/60 px-2 py-1.5 transition-colors hover:bg-muted/40 sm:gap-3 sm:px-3 sm:py-2"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(nextChecked) =>
                                onToggleSelectedUser(option.id, nextChecked === true)
                              }
                              className="h-3.5 w-3.5 sm:h-4 sm:w-4"
                            />
                            <span className="text-xs text-foreground sm:text-sm">{option.display_name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </div>
            ) : null}
          </div>
        </div>

        <div className="w-full space-y-4 rounded-3xl border border-border/70 bg-gradient-to-br from-muted/40 via-background to-background p-4 shadow-soft-sm md:min-w-0 md:flex-shrink-0 md:basis-80 lg:basis-96">
          <div>
            <p className="text-xs font-semibold text-foreground sm:text-sm">Resumen del reporte</p>
            <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
              Revisa el alcance antes de descargar el PDF.
            </p>
          </div>

          {validationError ? (
            <Alert variant="destructive" className="text-xs sm:text-sm">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-2 sm:gap-3">
            <ReportMetric label="Inspecciones" value={inspectionCount} />
            <ReportMetric label="Usuarios" value={usersCount} />
            <ReportMetric label="Contratos" value={contractsCount} />
          </div>

          <div className="space-y-3 rounded-2xl border border-border/70 bg-background/80 p-3 sm:p-4">
            <ReportSummaryItem label="Periodo" value={periodLabel || "-"} />
            <ReportSummaryItem label="Usuarios" value={scopeLabel || "-"} />
            <ReportSummaryItem
              label="Estado"
              value={loading ? "Cargando inspecciones..." : "Solo completadas"}
            />
          </div>

          {loading ? (
            <div className="flex min-h-[96px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/70 px-4 text-center">
              <Loader2 className="h-4 w-4 animate-spin text-primary sm:h-5 sm:w-5" />
              <p className="mt-3 text-xs font-medium text-foreground sm:text-sm">Preparando reporte</p>
              <p className="mt-1 text-xs text-muted-foreground">Consultando inspecciones para el periodo solicitado.</p>
            </div>
          ) : inspectionCount === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-background/70 px-4 py-5 text-xs text-muted-foreground sm:text-sm">
              No hay inspecciones completadas con los criterios actuales.
            </div>
          ) : null}
        </div>
      </div>

      <DialogFooter className="border-t border-border/60 bg-background flex-col-reverse gap-3 px-4 py-4 sm:px-6 sm:py-4 sm:flex-row sm:justify-end flex-shrink-0">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={exporting} className="w-full sm:w-auto">
          Cancelar
        </Button>
        <Button
          onClick={onGenerate}
          disabled={loading || exporting || Boolean(validationError) || inspectionCount === 0}
          className="w-full sm:w-auto"
        >
          {exporting ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Generando...
            </>
          ) : (
            <>
              <FileText className="mr-1.5 h-4 w-4" />
              Generar PDF
            </>
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

const ModeChip = ({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors sm:px-4 sm:py-2 sm:text-sm",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary-muted/40",
    )}
  >
    {label}
  </button>
);

const ReportMetric = ({
  label,
  value,
}: {
  label: string;
  value: number;
}) => (
  <div className="rounded-2xl border border-border/70 bg-background/85 p-3 sm:p-4">
    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">{label}</p>
    <p className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">{value}</p>
  </div>
);

const ReportSummaryItem = ({
  label,
  value,
}: {
  label: string;
  value: string;
}) => (
  <div className="space-y-1 border-b border-border/60 pb-3 last:border-0 last:pb-0">
    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-[11px]">{label}</p>
    <p className="text-xs text-foreground sm:text-sm">{value}</p>
  </div>
);

const StatCard = ({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: "primary" | "success" | "warning" | "info";
}) => {
  const toneMap = {
    primary: "bg-primary-muted text-primary",
    success: "bg-success-muted text-success",
    warning: "bg-warning-muted text-warning",
    info: "bg-accent text-accent-foreground",
  };

  return (
    <Card className="shadow-soft-sm transition-shadow hover:shadow-soft-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneMap[tone]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const TableActionButton = ({
  icon: Icon,
  title,
  onClick,
  tone = "default",
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  onClick: () => void;
  tone?: "default" | "warning" | "danger";
}) => {
  const toneMap = {
    default: "text-muted-foreground hover:border-primary/20 hover:bg-primary-muted hover:text-primary",
    warning: "text-muted-foreground hover:border-warning/20 hover:bg-warning-muted hover:text-warning",
    danger: "text-destructive hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive",
  };

  return (
    <Button
      size="icon"
      variant="ghost"
      className={cn(
        "h-9 w-9 rounded-full border border-border/60 bg-background shadow-soft-sm transition-all hover:-translate-y-0.5 hover:shadow-soft-md",
        toneMap[tone],
      )}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
};

const EmptyState = ({ onCreate }: { onCreate: () => void }) => (
  <div className="flex min-h-[320px] flex-col items-center justify-center rounded-3xl border border-dashed border-border/70 bg-gradient-to-br from-muted/60 via-background to-background px-6 py-16 text-center">
    <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[1.25rem] bg-primary-muted text-primary shadow-soft-sm">
      <FileSearch className="h-7 w-7" />
    </div>
    <h3 className="text-lg font-semibold text-foreground">No hay inspecciones para mostrar</h3>
    <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
      Ajusta los filtros o crea una nueva inspeccion para empezar a llenar este panel.
    </p>
    <Button size="sm" onClick={onCreate} className="mt-6 rounded-full px-4 shadow-soft-sm">
      <Plus className="mr-1.5 h-4 w-4" />
      Nueva inspeccion
    </Button>
  </div>
);

const DashboardInspectionCard = ({
  inspection,
  showCreator,
  canArchive,
  onView,
  onArchive,
  onDelete,
}: {
  inspection: DashboardInspection;
  showCreator: boolean;
  canArchive: boolean;
  onView: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) => (
  <div className="rounded-2xl border border-border/70 bg-background p-4 shadow-soft-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{inspection.contract_type || "-"}</p>
        <p className="text-xs text-muted-foreground">
          {inspection.inspection_date
            ? format(parseISO(inspection.inspection_date), "dd MMM yyyy", { locale: es })
            : "-"}
        </p>
      </div>
      <StatusBadge status={inspection.status} />
    </div>

    <p className="mt-3 text-sm text-muted-foreground">{inspection.subject ?? "Sin asunto"}</p>
    {showCreator ? (
      <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Usuario: <span className="normal-case tracking-normal">{inspection.creator_name ?? "-"}</span>
      </p>
    ) : null}

    <div className="mt-4 flex flex-wrap gap-2">
      <Button size="sm" variant="outline" onClick={onView} className="flex-1 min-w-[96px]">
        <Eye className="mr-1.5 h-4 w-4" />
        Ver
      </Button>
      {canArchive ? (
        <Button size="sm" variant="outline" onClick={onArchive} className="flex-1 min-w-[96px]">
          <Archive className="mr-1.5 h-4 w-4" />
          Archivar
        </Button>
      ) : null}
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

export default Dashboard;
