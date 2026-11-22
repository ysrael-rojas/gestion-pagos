// Escrituras del vertical de clientes: alta, modificacion y baja logica de `public.entidad`.
//
// Fuente: `lib/clientes/entidades.ts` (`createClientRecord`, `updateClientRecord`,
// `softDeleteClient`). Las tres operaciones son las mismas; lo que cambia es el transporte: el
// origen hablaba PostgREST con la sesion de Supabase, aca es una transaccion con la identidad
// del request puesta por `withOwner` (RLS + rol `authenticated`).
//
// Ninguna entrada puede fijar el dueno: `owner_id` sale del default `auth.uid()`, que dentro de
// `withOwner` es exactamente el usuario de la sesion. Los `where` con `ownerId` son defensa en
// profundidad (la garantia es la politica), no la garantia.
//
// DESVIOS DELIBERADOS respecto del origen, los dos chicos y anotados en el doc de la feature:
//
//   1. `document_number` de `SIN_DOCUMENTO` se normaliza a vacio en el SERVIDOR. El origen lo
//      hacia en el cliente (`mapFormValues`); hacerlo aca convierte el CHECK
//      `entidad_document_type_required` en una red de seguridad en vez de un error que el
//      usuario ve tras un viaje de ida y vuelta.
//   2. Si el id no existe (o ya esta borrado), la respuesta es 404 con un mensaje legible. El
//      origen dejaba escapar el error de PostgREST y lo mostraba como error generico.
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../db/db.provider";
import { entidad } from "../db/schema";
import { withOwner } from "../db/with-owner";
import {
	entityNotFound,
	toEntityHttpException,
} from "./entities.errors.ts";
import type { ClientBody } from "./entities.query.ts";
import type { ClientRecord } from "./entities.types.ts";

/** Las columnas del `ClientRecord`, una sola vez para las tres escrituras. */
const CLIENT_COLUMNS = {
	id: entidad.id,
	documentType: entidad.documentType,
	documentNumber: entidad.documentNumber,
	name: entidad.name,
	address: entidad.address,
	phone: entidad.phone,
	contactName: entidad.contactName,
	billingEmail: entidad.billingEmail,
	managementEmail: entidad.managementEmail,
	isClient: entidad.isClient,
	isSupplier: entidad.isSupplier,
};

/**
 * `document_number` que la tabla acepta para el tipo elegido.
 *
 * `SIN_DOCUMENTO` exige cadena vacia (`entidad_document_type_required`); el resto exige un
 * numero no vacio, y el formato ya lo valido el schema compartido antes de llegar aca.
 */
function documentNumberFor(values: ClientBody): string {
	return values.documentType === "SIN_DOCUMENTO" ? "" : values.documentNumber;
}

/**
 * Los campos que las dos escrituras comparten.
 *
 * `is_client` NO esta aca a proposito: el alta lo fija en `true` y la modificacion no lo toca,
 * asi que `entidad_some_role` nunca puede romperse por un update (mismo comportamiento que
 * `mapFormValues` del origen, que tampoco incluia `is_client`).
 */
function writableFields(values: ClientBody) {
	return {
		documentType: values.documentType,
		documentNumber: documentNumberFor(values),
		name: values.name,
		address: values.address,
		phone: values.phone,
		contactName: values.contactName,
		billingEmail: values.billingEmail,
		managementEmail: values.managementEmail,
		isSupplier: values.isSupplier,
	};
}

/** Condicion de fila "viva" del dueno de la sesion: lo que la politica RLS ya recorta, explicito. */
function liveRowOfOwner(ownerId: string, id: string) {
	return and(
		eq(entidad.id, id),
		eq(entidad.ownerId, ownerId),
		isNull(entidad.deletedAt),
	);
}

@Injectable()
export class EntitiesService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/** Alta de cliente (`createClientRecord`): `is_client` en `true`, `is_supplier` del formulario. */
	async create(ownerId: string, values: ClientBody): Promise<ClientRecord> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.insert(entidad)
					.values({ ...writableFields(values), isClient: true })
					.returning(CLIENT_COLUMNS);

				const created = rows[0];

				if (!created) {
					throw toEntityHttpException(null);
				}

				return created;
			});
		} catch (error) {
			throw toEntityHttpException(error);
		}
	}

	/** Modificacion (`updateClientRecord`): mismo payload, `is_client` intacto. */
	async update(ownerId: string, id: string, values: ClientBody): Promise<ClientRecord> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.update(entidad)
					.set(writableFields(values))
					.where(liveRowOfOwner(ownerId, id))
					.returning(CLIENT_COLUMNS);

				const updated = rows[0];

				if (!updated) {
					throw entityNotFound();
				}

				return updated;
			});
		} catch (error) {
			throw toEntityHttpException(error);
		}
	}

	/**
	 * Baja logica (`softDeleteClient`): solo `deleted_at`.
	 *
	 * No hay guard por referencias: el origen tampoco lo tenia y un cliente con comprobantes o
	 * pagos sigue siendo borrable (decision en el doc de la feature, S4). El `updated_at` lo
	 * mueve el trigger `entidad_set_updated_at`.
	 */
	async softDelete(ownerId: string, id: string): Promise<void> {
		try {
			await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.update(entidad)
					.set({ deletedAt: sql`now()` })
					.where(liveRowOfOwner(ownerId, id))
					.returning({ id: entidad.id });

				if (rows.length === 0) {
					throw entityNotFound();
				}
			});
		} catch (error) {
			throw toEntityHttpException(error);
		}
	}
}
