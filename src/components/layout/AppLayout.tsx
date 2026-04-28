import { Outlet, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Sidebar } from "./Sidebar";

export const AppLayout = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar />
      <main className="flex min-h-screen min-w-0 flex-1 flex-col pb-24 md:pb-0">
        <Outlet />
      </main>
    </div>
  );
};
