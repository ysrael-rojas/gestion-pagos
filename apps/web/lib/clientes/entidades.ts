// Entidades (clientes/proveedores) del lado de la UI.
//
// Port de `lib/clientes/entidades.ts` del origen (137 lineas). El origen hablaba PostgREST
// (`supabase.from("entidad")`) con la sesion de Supabase; aca es `apps/api` por HTTP, que hace
// las mismas operaciones dentro de `withOwner` con la RLS encima.
//
// Lo que NO viaja del origen:
//   - `mapFormValues`: el body del API es el schema compartido en camelCase, asi que los valores
//     del formulario van tal cual. La normalizacion de `SIN_DOCUMENTO` a numero vacio ahora es
//     del servidor (`entities.service.ts`), no del cliente.
//   - `mapError`: el origen traducia el `23505` de PostgREST a un `Error` con el mensaje en
//     espanol. Esa traduccion ahora es del API (`entities.errors.ts`), que devolve el mismo
//     mensaje dentro de un 409; `lib/api/client.ts` lo convierte en `ApiError` con ese texto.
//
// El orden de las lecturas se queda donde estaba: clientes por alta descendente y proveedores
// alfabeticos, porque lo decide el API (`catalogs.service.ts`) y el autocomplete depende de el.
import {
  type ClientRecord,
  type EntityCatalogItem,
  createEntity,
  listEntities,
  softDeleteEntity,
  updateEntity,
} from "@/lib/api/client";
import type { ClientFormValues } from "@gestion/shared";
import type { Client } from "@/components/clientes/types";

/** Fila del API -> forma de la UI. Las dos tienen los mismos campos útiles; `isClient` no se usa. */
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

/** Alta (`createClientRecord`): siempre cliente, `is_supplier` sale del formulario. */
export async function createClientRecord(values: ClientFormValues): Promise<Client> {
  return toClient(await createEntity(values));
}

/** Modificacion (`updateClientRecord`): mismo payload, `is_client` no se toca. */
export async function updateClientRecord(id: string, values: ClientFormValues): Promise<Client> {
  return toClient(await updateEntity(id, values));
}

/** Baja logica (`softDeleteClient`): la fila queda, marcada, fuera del listado. */
export async function softDeleteClient(id: string): Promise<void> {
  await softDeleteEntity(id);
}

/** El tipo crudo, para quien necesite `isClient` (hoy nadie: la UI lista clientes). */
export type { ClientRecord };
