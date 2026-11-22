"use client";

// Portado de `components/auth/auth-form.tsx` del origen. Dos cambios, ambos forzados por el
// stack y no por gusto:
//
// 1. Donde el origen enviaba las credenciales a Supabase via una Server Action invocada a mano
//    (`useTransition` + `signIn(...)`), esto usa `useActionState` con el `action` del formulario.
//    Resultado: el formulario funciona tambien sin JavaScript (POST al mismo `/login`), que es
//    lo que permite probar el login real de punta a punta sin automatizar un navegador.
// 2. No se porta `react-hook-form` + `@hookform/resolvers`. El origen los usaba para validar dos
//    campos con `loginSchema`; aca el schema se valida en la Server Action (`@gestion/shared`,
//    el mismo contrato que valida apps/api) y el mensaje vuelve por `state.error`. Dos
//    dependencias nuevas para dos `required` no se justifican.
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, type AuthFormState } from "@/app/login/actions";

const INITIAL_STATE: AuthFormState = { error: null };

/**
 * Solo inicio de sesion. El alta de cuentas no existe en la app: las cuentas las crea el dueno
 * del sistema. `apps/api` tiene `emailAndPassword` habilitado, pero la pantalla no expone
 * registro.
 */
export function AuthForm() {
  const [state, formAction, isPending] = useActionState(signIn, INITIAL_STATE);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>Ingresa con tu correo y contraseña</CardDescription>
      </CardHeader>
      <CardContent>
        {/* `noValidate`: la validacion nativa de `required`/`type=email` bloquea el submit antes
        de que la Server Action vea el payload, y dejaria inalcanzable el mensaje de
        `loginSchema`. El schema es el unico dueno de la validacion (mismo criterio que el
        origen, donde lo era el resolver de zod). */}
        <form action={formAction} noValidate className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Correo</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(state.error)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={Boolean(state.error)}
            />
          </div>

          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <Button type="submit" disabled={isPending}>
            {isPending ? "Procesando..." : "Iniciar sesión"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
