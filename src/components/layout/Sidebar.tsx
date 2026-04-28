import { useState } from "react";
import {
  Archive,
  FilePlus,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  Menu,
  ShieldCheck,
  User,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const navItems = [
  { to: "/", label: "Dashboard", shortLabel: "Inicio", icon: LayoutDashboard, end: true },
  { to: "/inspections/new", label: "Nueva inspeccion", shortLabel: "Nueva", icon: FilePlus },
  { to: "/inspections/types", label: "Tipos de contrato", shortLabel: "Tipos", icon: ListChecks, subItem: true },
  { to: "/archived", label: "Archivadas", shortLabel: "Archivo", icon: Archive },
];

const desktopLinkClass = (isActive: boolean, isSubItem = false) =>
  cn(
    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
    isSubItem && "ml-6 rounded-l-none border-l border-sidebar-border/70 py-2 pl-4 text-[13px]",
    isActive
      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-soft-sm"
      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
  );

const mobileNavClass = (isActive: boolean) =>
  cn(
    "flex h-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium transition-colors",
    isActive
      ? "bg-primary-muted text-primary"
      : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
  );

export const Sidebar = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;

    setSigningOut(true);

    try {
      await signOut();
    } catch (error) {
      console.error("Error en signOut:", error);
    } finally {
      setMobileMenuOpen(false);
      toast.success("Sesion cerrada");
      navigate("/auth", { replace: true });
      setSigningOut(false);
    }
  };

  const handleProfileNavigation = () => {
    setMobileMenuOpen(false);
    navigate("/profile");
  };

  const fullName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Invitado";
  const initials = fullName.slice(0, 2).toUpperCase();

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary shadow-soft-md">
            <ShieldCheck className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">InspectPro</p>
            <p className="mt-1 text-[11px] text-sidebar-foreground/60">Gestion de inspecciones</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => desktopLinkClass(isActive, item.subItem)}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div
            onClick={() => navigate("/profile")}
            className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-sidebar-accent"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{fullName}</p>
              <p className="text-[10px] text-sidebar-foreground/50">Inspector</p>
            </div>
            <button
              onClick={(event) => {
                event.stopPropagation();
                void handleSignOut();
              }}
              disabled={signingOut}
              type="button"
              className="cursor-pointer rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Cerrar sesion"
              title="Cerrar sesion"
            >
              {signingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
        <nav className="grid h-16 grid-cols-5 gap-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => mobileNavClass(isActive)}
            >
              <item.icon className="h-4 w-4" />
              <span className="truncate">{item.shortLabel}</span>
            </NavLink>
          ))}

          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="flex h-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                aria-label="Abrir menu"
              >
                <Menu className="h-4 w-4" />
                <span>Menu</span>
              </button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-[86vw] max-w-sm border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
            >
              <div className="flex h-full flex-col">
                <SheetHeader className="border-b border-sidebar-border px-5 py-4 text-left">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-primary shadow-soft-md">
                      <ShieldCheck className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <div>
                      <SheetTitle className="text-sm text-sidebar-foreground">InspectPro</SheetTitle>
                      <SheetDescription className="text-xs text-sidebar-foreground/60">
                        Gestion de inspecciones
                      </SheetDescription>
                    </div>
                  </div>
                </SheetHeader>

                <nav className="flex-1 space-y-1 p-3">
                  {navItems.map((item) => (
                    <NavLink
                      key={`mobile-${item.to}`}
                      to={item.to}
                      end={item.end}
                      onClick={() => setMobileMenuOpen(false)}
                      className={({ isActive }) => desktopLinkClass(isActive, false)}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  ))}

                  <button
                    type="button"
                    onClick={handleProfileNavigation}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  >
                    <User className="h-4 w-4" />
                    Mi perfil
                  </button>
                </nav>

                <div className="border-t border-sidebar-border p-4">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{fullName}</p>
                      <p className="text-xs text-sidebar-foreground/50">Inspector</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    disabled={signingOut}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent px-4 py-2.5 text-sm font-medium text-sidebar-accent-foreground transition-colors hover:bg-sidebar-accent/80 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {signingOut ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <LogOut className="h-4 w-4" />
                    )}
                    Cerrar sesion
                  </button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </nav>
      </div>
    </>
  );
};
