"use server";

import { crearClienteSupabase } from "@/lib/supabase/server";
import {
  normalizarCampos,
  validar,
  type DatosActualizacion,
  type DatosTercero,
  type Resultado,
  type Tercero,
} from "@/lib/terceros/dominio";
import { aFila, aTercero, erroresDesdePostgrest } from "@/lib/terceros/mapeo";

export async function listarTerceros(): Promise<Tercero[]> {
  const supabase = crearClienteSupabase();
  const { data, error } = await supabase
    .from("third_parties")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    console.error("Error al listar Terceros:", error);
    throw new Error("No se pudieron cargar los Terceros.");
  }

  return data.map(aTercero);
}

export async function crearTercero(datos: DatosTercero): Promise<Resultado<Tercero>> {
  const normalizado = normalizarCampos(datos);
  const errores = validar(normalizado, []);
  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  const supabase = crearClienteSupabase();
  const { data, error } = await supabase
    .from("third_parties")
    .insert(aFila(normalizado))
    .select()
    .single();

  if (error) {
    return { ok: false, errores: erroresDesdePostgrest(error) };
  }

  return { ok: true, valor: aTercero(data) };
}

export async function actualizarTercero(
  id: string,
  datos: DatosActualizacion,
): Promise<Resultado<Tercero>> {
  const normalizado = normalizarCampos(datos);
  const errores = validar(normalizado, []);
  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  const supabase = crearClienteSupabase();
  const { data, error } = await supabase
    .from("third_parties")
    .update(aFila({ ...normalizado, activo: datos.activo }))
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return { ok: false, errores: erroresDesdePostgrest(error) };
  }

  return { ok: true, valor: aTercero(data) };
}

async function cambiarActivo(id: string, activo: boolean): Promise<Resultado<Tercero>> {
  const supabase = crearClienteSupabase();
  const { data, error } = await supabase
    .from("third_parties")
    .update({ active: activo })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return { ok: false, errores: erroresDesdePostgrest(error) };
  }

  return { ok: true, valor: aTercero(data) };
}

export async function desactivarTercero(id: string): Promise<Resultado<Tercero>> {
  return cambiarActivo(id, false);
}

export async function reactivarTercero(id: string): Promise<Resultado<Tercero>> {
  return cambiarActivo(id, true);
}
