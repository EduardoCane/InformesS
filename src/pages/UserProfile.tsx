import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const UserProfile = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      setFullName(user.user_metadata?.full_name || "");
      setEmail(user.email || "");
    }
  }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fullName.trim()) {
      toast.error("El nombre completo es requerido");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: {
          full_name: fullName.trim(),
        },
      });

      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Perfil actualizado correctamente");
        navigate("/", { replace: true });
      }
    } catch (err) {
      toast.error("Error al guardar los cambios");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <Header
        title="Perfil de Usuario"
        subtitle="Edita tu información personal"
        actions={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            className="h-9 w-9"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        }
        showSearch={false}
        showSettings={false}
      />

      <div className="flex-1 overflow-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  <UserIcon className="h-6 w-6" />
                </div>
                <div>
                  <CardTitle>Mi Perfil</CardTitle>
                  <CardDescription>
                    Actualiza tu información personal
                  </CardDescription>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSave} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Nombre Completo</Label>
                  <Input
                    id="fullName"
                    placeholder="Ingresa tu nombre completo"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={saving}
                  />
                  <p className="text-xs text-muted-foreground">
                    Este es el nombre que aparecerá en tu perfil
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="tu@email.com"
                    value={email}
                    disabled
                    className="bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">
                    Tu email no puede ser modificado
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Rol</Label>
                  <Input
                    type="text"
                    value="Inspector"
                    disabled
                    className="bg-muted"
                  />
                </div>

                <div className="flex flex-col-reverse gap-3 sm:flex-row">
                  <Button
                    type="submit"
                    disabled={saving}
                    className="w-full flex-1"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Guardando...
                      </>
                    ) : (
                      "Guardar Cambios"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate("/")}
                    disabled={saving}
                    className="w-full flex-1"
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};

export default UserProfile;
