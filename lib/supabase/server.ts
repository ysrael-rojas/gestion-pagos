import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";

import type { Database } from "@/lib/database.types";

function leerUrlSupabase(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!url) {
    throw new Error(
      "Falta NEXT_PUBLIC_SUPABASE_URL. Copia .env.template a .env y completa la variable.",
    );
  }

  return url;
}

function leerClavePublicable(): string {
  const clavePublicable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!clavePublicable) {
    throw new Error(
      "Falta NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copia .env.template a .env y completa la variable.",
    );
  }

  return clavePublicable;
}

export async function crearClienteSesion(): Promise<SupabaseClient<Database>> {
  const almacenCookies = await cookies();

  return createServerClient<Database>(leerUrlSupabase(), leerClavePublicable(), {
    cookies: {
      getAll() {
        return almacenCookies.getAll();
      },
      setAll(cookiesAEscribir) {
        try {
          cookiesAEscribir.forEach(({ name, value, options }) => {
            almacenCookies.set(name, value, options);
          });
        } catch {
          // Un Server Component no puede escribir cookies. El refresco real
          // ocurre en proxy.ts; aquí se ignora de forma deliberada.
        }
      },
    },
  });
}

export const crearClienteAdmin = cache((): SupabaseClient<Database> => {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      "Falta SUPABASE_SERVICE_ROLE_KEY. Copia .env.template a .env y completa la variable.",
    );
  }

  return createClient<Database>(leerUrlSupabase(), serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
});
