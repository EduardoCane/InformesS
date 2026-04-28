import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type ConfirmActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: "default" | "destructive";
  onConfirm: () => void;
};

export const ConfirmActionDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  confirmTone = "default",
  onConfirm,
}: ConfirmActionDialogProps) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className="max-w-md rounded-2xl border-border/70 bg-background/95 shadow-soft-md">
      <AlertDialogHeader className="space-y-3 text-left">
        <AlertDialogTitle className="text-base font-semibold text-foreground">
          {title}
        </AlertDialogTitle>
        <AlertDialogDescription className="text-sm leading-6 text-muted-foreground">
          {description}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel className="rounded-full">
          {cancelLabel}
        </AlertDialogCancel>
        <AlertDialogAction
          onClick={onConfirm}
          className={cn(
            "rounded-full",
            confirmTone === "destructive" &&
              "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive",
          )}
        >
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
