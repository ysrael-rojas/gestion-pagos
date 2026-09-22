"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { crearClienteSesion } from "@/lib/supabase/server";

export async function cerrarSesion() {
  const supabase = await crearClienteSesion();

  await supabase.auth.signOut();

  revalidatePath("/", "layout");
  redirect("/login");
}
