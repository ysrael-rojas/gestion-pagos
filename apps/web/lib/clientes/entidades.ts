// Entidades (clientes/proveedores) del lado de la UI.
//
// Port de la parte de lectura de `lib/clientes/entidades.ts` del origen (136 lineas). El origen
// leia `entidad` desde Supabase con `.eq("is_client", true)`; aca es `GET /entities?role=`, que
// hace la misma consulta con `withOwner` y la RLS encima.
//
// Las tres escrituras del origen (`createClientRecord`, `updateClientRecord`,
// `softDeleteClient`) NO se portan: pertenecen al vertical de clientes (T5c) y `apps/api` todavia
// no expone esas rutas. Portarlas seria cablear contra endpoints que no existen. Nada del
// vertical de pagos las usa: el autocomplete solo lee.
import { type EntityCatalogItem, listEntities } from "@/lib/api/client";
import type { Client } from "@/components/clientes/types";

function toClient(entity: EntityCatalogItem): Client {
  return {
    id: entity.id,
    documentType: entity.documentType,
    documentNumber: entity.documentNumber,
    name: entity.name,
    address: entity.address,
    phone: entity.phone,
    contactName: entity.contactName,
    billingEmail: entity.billingEmail,
    managementEmail: entity.managementEmail,
    isSupplier: entity.isSupplier,
  };
}

/** Clientes del dueno, por alta descendente (el orden del origen). */
export async function listClients(): Promise<Client[]> {
  return (await listEntities("client")).map(toClient);
}

/** Proveedores del dueno, alfabetico (el orden del origen). */
export async function listSuppliers(): Promise<Client[]> {
  return (await listEntities("supplier")).map(toClient);
}
