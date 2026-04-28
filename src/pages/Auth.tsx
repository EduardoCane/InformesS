import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const Auth = () => {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [user, loading, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!signInEmail.trim() || !signInPassword.trim()) {
      toast.error("Completa email y contrasena");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: signInEmail,
      password: signInPassword,
    });
    setSubmitting(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Bienvenido de vuelta");
      navigate("/", { replace: true });
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim() || !signUpEmail.trim() || !signUpPassword.trim()) {
      toast.error("Completa todos los campos");
      return;
    }

    if (signUpPassword.length < 6) {
      toast.error("La contrasena debe tener al menos 6 caracteres");
      return;
    }

    setSubmitting(true);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: signUpEmail,
        password: signUpPassword,
        options: {
          data: { full_name: fullName },
        },
      });

      if (signUpError) {
        toast.error(signUpError.message);
        setSubmitting(false);
        return;
      }

      if (!data.user) {
        toast.error("No se pudo crear la cuenta");
        setSubmitting(false);
        return;
      }

      setSignUpEmail("");
      setSignUpPassword("");
      setFullName("");

      if (data.session) {
        toast.success("Cuenta creada exitosamente");
        navigate("/", { replace: true });
        return;
      }

      toast.success("Cuenta creada. Revisa tu correo para confirmar el acceso.");
    } catch {
      toast.error("Error inesperado. Intenta de nuevo");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-accent/30 p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="h-11 w-11 rounded-xl bg-gradient-primary flex items-center justify-center shadow-soft-lg">
            <ShieldCheck className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <p className="text-xl font-semibold tracking-tight">InspectPro</p>
            <p className="text-xs text-muted-foreground">Gestion profesional de inspecciones</p>
          </div>
        </div>

        <Card className="shadow-soft-lg border-border/60">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Acceso al sistema</CardTitle>
            <CardDescription>Inicia sesion o crea una cuenta nueva</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Iniciar sesion</TabsTrigger>
                <TabsTrigger value="signup">Crear cuenta</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="email-in">Email</Label>
                    <Input
                      id="email-in"
                      type="email"
                      required
                      value={signInEmail}
                      onChange={(e) => setSignInEmail(e.target.value)}
                      placeholder="tu@empresa.com"
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pass-in">Contrasena</Label>
                    <Input
                      id="pass-in"
                      type="password"
                      required
                      value={signInPassword}
                      onChange={(e) => setSignInPassword(e.target.value)}
                      disabled={submitting}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Entrar
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="name-up">Nombre completo</Label>
                    <Input
                      id="name-up"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Juan Perez"
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email-up">Email</Label>
                    <Input
                      id="email-up"
                      type="email"
                      required
                      value={signUpEmail}
                      onChange={(e) => setSignUpEmail(e.target.value)}
                      placeholder="tu@empresa.com"
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pass-up">Contrasena</Label>
                    <Input
                      id="pass-up"
                      type="password"
                      required
                      minLength={6}
                      value={signUpPassword}
                      onChange={(e) => setSignUpPassword(e.target.value)}
                      disabled={submitting}
                    />
                    <p className="text-[11px] text-muted-foreground">Minimo 6 caracteres</p>
                  </div>
                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Crear cuenta
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          <Link to="/" className="hover:text-foreground">
            {"<-"} Volver al inicio
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Auth;
