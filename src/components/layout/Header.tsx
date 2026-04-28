import { forwardRef } from "react";
import { Search, Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  showSearch?: boolean;
  showSettings?: boolean;
}

export const Header = forwardRef<HTMLElement, HeaderProps>(
  ({ title, subtitle, actions, showSearch = true, showSettings = true }, ref) => {
    const hasControls = showSearch || showSettings || Boolean(actions);

    return (
      <header
        ref={ref}
        className="sticky top-0 z-10 border-b border-border bg-card/60 backdrop-blur-sm"
      >
        <div className="flex min-h-16 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-foreground">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>

          {hasControls && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              {showSearch && (
                <div className="relative hidden lg:block">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Buscar..."
                    className="h-9 w-64 bg-background pl-9"
                  />
                </div>
              )}
              {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
              {showSettings && (
                <Button variant="ghost" size="icon" className="ml-auto h-9 w-9 sm:ml-0">
                  <Settings className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </header>
    );
  },
);

Header.displayName = "Header";
