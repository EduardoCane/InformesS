import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  draft: { label: "Borrador", className: "bg-warning-muted text-warning border-warning/20" },
  pending: { label: "Pendiente", className: "bg-warning-muted text-warning border-warning/20" },
  in_progress: { label: "En proceso", className: "bg-accent text-accent-foreground border-primary/20" },
  completed: { label: "Completada", className: "bg-success-muted text-success border-success/20" },
  archived: { label: "Archivada", className: "bg-muted text-muted-foreground border-border/70" },
};

const RESULT_MAP: Record<string, { label: string; className: string }> = {
  Cumple: { label: "Cumple", className: "bg-success-muted text-success border-success/20" },
  "No cumple": { label: "No cumple", className: "bg-destructive/10 text-destructive border-destructive/20" },
};

export const StatusBadge = ({ status }: { status: string }) => {
  const conf = STATUS_MAP[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return (
    <Badge
      variant="outline"
      className={cn(
        "min-w-[7.75rem] justify-center rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.08em] shadow-soft-sm",
        conf.className,
      )}
    >
      {conf.label}
    </Badge>
  );
};

export const ResultBadge = ({ result }: { result: string | null }) => {
  if (!result) return <span className="text-xs text-muted-foreground">—</span>;
  const conf = RESULT_MAP[result] ?? { label: result, className: "bg-muted text-muted-foreground" };
  return (
    <Badge
      variant="outline"
      className={cn(
        "min-w-[6.5rem] justify-center rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.08em] shadow-soft-sm",
        conf.className,
      )}
    >
      {conf.label}
    </Badge>
  );
};
