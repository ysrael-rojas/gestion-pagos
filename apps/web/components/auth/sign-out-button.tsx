"use client";

// Portado de `components/auth/sign-out-button.tsx` del origen.
//
// El origen llamaba la Server Action desde `onClick` (y por eso el boton no hacia nada sin
// JavaScript). Aca el boton es el `submit` de un formulario cuyo `action` es la Server Action:
// mismo efecto, funciona sin JavaScript y `useFormStatus` da el estado pendiente sin manejar
// transiciones a mano.
import { useFormStatus } from "react-dom";

import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

function SignOutSubmit({ className }: { className?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="ghost"
      className={cn(
        "w-full justify-start font-semibold text-muted-foreground hover:bg-transparent hover:text-foreground",
        className,
      )}
      disabled={pending}
    >
      {pending ? "Cerrando sesión..." : "Cerrar sesión"}
    </Button>
  );
}

export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOut}>
      <SignOutSubmit className={className} />
    </form>
  );
}
