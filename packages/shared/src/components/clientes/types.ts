// Entidad (cliente o proveedor): the shape apps/api returns and the web consumes.
//
// One source of truth (S6 of `odd/tasks/port-vertical-clientes.md`). `apps/web` keeps
// `@/components/clientes/types` as a thin re-export of this file so the existing
// `@/components/clientes/types` imports of the pagos vertical did not have to move.
//
// `isSupplier` is REQUIRED: the source declared it optional because its PostgREST payload could
// omit it, but `GET /entities` and the write endpoints always send it (`EntityCatalogItem` and
// `ClientRecord` both declare it `boolean`), so optional here would force every consumer to
// handle a case that cannot happen.
export type DocumentType =
  | "RUC"
  | "DNI"
  | "CARNET_EXTRANJERIA"
  | "SIN_DOCUMENTO";

export interface Client {
  id: string;
  documentType: DocumentType;
  documentNumber: string;
  name: string;
  address: string;
  phone: string;
  contactName: string;
  billingEmail: string;
  managementEmail: string;
  isSupplier: boolean;
}
