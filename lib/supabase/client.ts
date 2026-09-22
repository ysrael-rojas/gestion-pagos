import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/database.types";

function leerCredencialesPublicas(): { url: string; clavePublicable: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clavePublicable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !clavePublicable) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copia .env.template a .env y completa ambas variables.",
    );
  }

  return { url, clavePublicable };
}

export function crearClienteNavegador() {
  const { url, clavePublicable } = leerCredencialesPublicas();

  return createBrowserClient<Database>(url, clavePublicable);
}
