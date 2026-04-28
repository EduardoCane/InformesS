import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const getNormalizedFullName = (authUser: User) => {
  const rawFullName =
    authUser.user_metadata?.full_name ?? authUser.user_metadata?.name ?? "";
  const normalizedFullName = String(rawFullName).trim();

  return normalizedFullName || null;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Obtener sesión actual y escuchar cambios de autenticación
  useEffect(() => {
    let mounted = true;
    let syncInFlightForUserId: string | null = null;
    const timeoutId = setTimeout(() => {
      if (mounted) {
        console.warn("Auth initialization timeout - Supabase did not respond in time");
        setLoading(false);
      }
    }, 20000); // Dar margen a proyectos en cold start

    const syncUserProfile = async (authUser: User) => {
      if (syncInFlightForUserId === authUser.id) return;
      const normalizedEmail = authUser.email?.trim();

      if (!normalizedEmail) {
        console.warn("Authenticated user has no email; skipping users_profile sync", authUser.id);
        return;
      }

      syncInFlightForUserId = authUser.id;

      try {
        const { error } = await supabase
          .from("users_profile")
          .upsert(
            {
              id: authUser.id,
              email: normalizedEmail,
              full_name: getNormalizedFullName(authUser),
            },
            {
              onConflict: "id",
            },
          );

        if (error) {
          console.error("Error updating profile:", error);
        }
      } catch (error) {
        console.error("Error in profile upsert:", error);
      } finally {
        syncInFlightForUserId = null;
      }
    };

    const initializeAuth = async () => {
      try {
        // Obtener sesión existente
        const { data: { session: currentSession }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error("Error getting session:", error);
        }

        if (mounted) {
          setSession(currentSession ?? null);
          setUser(currentSession?.user ?? null);
        }

        if (currentSession?.user) {
          void syncUserProfile(currentSession.user);
        }
      } catch (error) {
        console.error("Error initializing auth:", error);
        if (mounted) {
          setSession(null);
          setUser(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
          clearTimeout(timeoutId);
        }
      }
    };

    initializeAuth();

    // Escuchar cambios de autenticación en tiempo real
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (mounted) {
        setSession(currentSession ?? null);
        setUser(currentSession?.user ?? null);
      }

      // No hacer await ni queries del mismo cliente dentro del callback de auth.
      if (currentSession?.user) {
        setTimeout(() => {
          void syncUserProfile(currentSession.user);
        }, 0);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      authListener?.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.warn("SignOut timeout - forcing completion");
        setUser(null);
        setSession(null);
        resolve();
      }, 3000); // 3 segundos de timeout

      (async () => {
        try {
          console.log("Ejecutando supabase.auth.signOut()...");
          const { error } = await supabase.auth.signOut();
          
          if (error) {
            console.error("Error from Supabase signOut:", error);
            throw error;
          }

          console.log("SignOut completado");
          setUser(null);
          setSession(null);
          clearTimeout(timeoutId);
          resolve();
        } catch (error) {
          console.error("Error in signOut:", error);
          clearTimeout(timeoutId);
          setUser(null);
          setSession(null);
          resolve(); // Resolver igual aunque haya error
        }
      })();
    });
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
