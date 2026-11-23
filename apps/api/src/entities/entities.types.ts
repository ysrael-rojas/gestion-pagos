// Contrato de salida del vertical de clientes (T5c).
//
// La forma es el `Client` de `components/clientes/types.ts` del origen, con los nombres
// camelCase del resto del contrato del monorepo, mas `isClient`--que el origen no declaraba
// porque la UI solo listaba clientes de una sola tabla-- para que el mismo tipo pueda describir
// tambien a un proveedor sin inventar un segundo tipo.
import { documentTypeEnum } from "../db/schema/enums.ts";

/** Los cuatro valores del enum `document_type`, derivados del schema (una sola fuente de verdad). */
type DocumentType = (typeof documentTypeEnum.enumValues)[number];

/** Entidad (cliente o proveedor) tal como la devuelven las escrituras del vertical. */
export interface ClientRecord {
	id: string;
	documentType: DocumentType;
	documentNumber: string;
	name: string;
	address: string;
	phone: string;
	contactName: string;
	billingEmail: string;
	managementEmail: string;
	isClient: boolean;
	isSupplier: boolean;
}
