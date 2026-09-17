import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";

import type { Database } from "@/lib/database.types";

function leerCredenciales(): { url: string; serviceRoleKey: string } {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. Copia .env.template a .env y completa ambas variables.",
    );
  }

  return { url, serviceRoleKey };
}

export const crearClienteSupabase = cache((): SupabaseClient<Database> => {
  const { url, serviceRoleKey } = leerCredenciales();

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
});
