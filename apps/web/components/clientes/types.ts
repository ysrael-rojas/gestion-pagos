// Entidad (cliente o proveedor), portado tal cual de `components/clientes/types.ts` del origen.
//
// El vertical de pagos lo usa para el autocomplete y para resolver nombres por id: los dos
// necesitan solo `id`, `name` y el par documento, pero se mantiene la forma completa porque es el
// contrato que devuelve `GET /entities` y lo que T5c va a reusar para el vertical de clientes.
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
  isSupplier?: boolean;
}
