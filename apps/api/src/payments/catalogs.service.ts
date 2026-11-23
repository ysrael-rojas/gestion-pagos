// Catalogos del vertical de pagos: las cuatro lecturas que necesita el formulario de alta mas el
// sembrado explicito de las semillas del origen, y —desde C7 del vertical de cajas-bancos— las
// ESCRITURAS de los dos catalogos editables (metodos de pago y categorias de recibo).
//
// De donde sale cada lectura (proyecto de origen, leido como fuente):
//   entities            <- lib/clientes/entidades.ts        (listClients / listSuppliers)
//   cashAccounts        <- lib/cuentas/entidades.ts         (listCashAccounts)
//   paymentMethods      <- lib/caja/caja.ts                 (listPaymentMethods)
//   receiptCategories   <- lib/caja/caja.ts                 (listCategories)
//
// Las cuatro son lecturas del dueno de la sesion: `withOwner` fija `app.user_id` y cambia el rol
// a `authenticated`, y las politicas RLS recortan las filas. Ninguna acepta un `owner_id` por
// HTTP.
//
// DESVIO DELIBERADO (unico) respecto del origen: `ensureCatalogsSeeded()` del origen corria
// dentro del render del formulario, es decir un GET que escribe. Un GET que muta no es
// comportamiento a preservar, asi que el mismo efecto se expone como `POST /catalogs/ensure`,
// idempotente y explicito, y la web lo llama una vez cuando las lecturas vuelven vacias. Los
// codigos y nombres son los mismos (`catalogs.defaults.ts`), asi que las filas sembradas son
// intercambiables con las que ya creo `seed-demo.sql`.
//
// C7 — ESCRITURAS. El port tenia solo lecturas; faltaban el alta y la modificacion de metodos y
// categorias (`createPaymentMethod`, `updatePaymentMethod`, `createCategory`, `updateCategory` del
// origen, `lib/caja/caja.ts:238-320`). Tres decisiones se portan tal cual:
//
//   1. NO hay borrado: desactivar es `isActive: false`, y la fila sigue existiendo porque los
//      recibos la referencian desde `payment.method_id` / `payment.category_id`.
//   2. El `code` de un metodo es INMUTABLE despues del alta y el de una categoria se DERIVA del
//      nombre en un solo lugar (`categoryCodeFromName`, `catalogs.defaults.ts`), porque la columna
//      es `not null` y `unique (owner_id, code)`.
//   3. El duplicado de codigo responde 409 con un mensaje que NOMBRA el codigo
//      (`payments.errors.ts`, `toCatalogHttpException`), no el texto crudo del `23505`.
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../db/db.provider";
import { cashAccount, cashReceiptCategory, entidad, paymentMethod } from "../db/schema";
import { withOwner } from "../db/with-owner";
import {
	CATEGORY_EMPTY_CODE_MESSAGE,
	categoryCodeFromName,
	DEFAULT_CATEGORIES,
	DEFAULT_PAYMENT_METHODS,
} from "./catalogs.defaults.ts";
import type {
	CashAccountCatalogItem,
	CashReceiptCategoryCatalogItem,
	CatalogSeedResult,
	EntityCatalogItem,
	PaymentMethodCatalogItem,
} from "./catalogs.types.ts";
import type {
	EntitiesQuery,
	PaymentMethodBody,
	PaymentMethodPatch,
	PaymentMethodsQuery,
	ReceiptCategoriesQuery,
	ReceiptCategoryBody,
	ReceiptCategoryPatch,
} from "./catalogs.query.ts";
import {
	paymentMethodNotFound,
	receiptCategoryNotFound,
	toCatalogHttpException,
	toHttpException,
} from "./payments.errors.ts";

@Injectable()
export class CatalogsService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * Entidades no borradas del dueno, por rol (`listClients` / `listSuppliers` del origen).
	 *
	 * El orden es el del origen y no es cosmetico: los clientes se listan por alta descendente
	 * (el autocomplete muestra primero lo ultimo creado) y los proveedores alfabeticamente.
	 */
	async entities(ownerId: string, query: EntitiesQuery): Promise<EntityCatalogItem[]> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const isClient = query.role === "client";

				const rows = await tx
					.select({
						id: entidad.id,
						documentType: entidad.documentType,
						documentNumber: entidad.documentNumber,
						name: entidad.name,
						address: entidad.address,
						phone: entidad.phone,
						contactName: entidad.contactName,
						billingEmail: entidad.billingEmail,
						managementEmail: entidad.managementEmail,
						isSupplier: entidad.isSupplier,
					})
					.from(entidad)
					.where(
						and(
							isNull(entidad.deletedAt),
							isClient ? eq(entidad.isClient, true) : eq(entidad.isSupplier, true),
						),
					)
					.orderBy(isClient ? desc(entidad.createdAt) : asc(entidad.name));

				return rows;
			});
		} catch (error) {
			throw toHttpException(error);
		}
	}

	/**
	 * Cuentas de caja y banco no borradas (`listCashAccounts` del origen).
	 *
	 * El origen trae la fila completa porque el vertical de cajas-bancos la edita; aca solo viajan
	 * las columnas del selector. Orden: por tipo y luego nombre, igual que el origen.
	 */
	async cashAccounts(ownerId: string): Promise<CashAccountCatalogItem[]> {
		try {
			return await withOwner(this.db, ownerId, async (tx) =>
				tx
					.select({
						id: cashAccount.id,
						type: cashAccount.type,
						name: cashAccount.name,
						currency: cashAccount.currency,
						isActive: cashAccount.isActive,
					})
					.from(cashAccount)
					.where(isNull(cashAccount.deletedAt))
					.orderBy(asc(cashAccount.type), asc(cashAccount.name)),
			);
		} catch (error) {
			throw toHttpException(error);
		}
	}

	/** Metodos de pago del dueno (`listPaymentMethods(onlyActive)` del origen), por nombre. */
	async paymentMethods(
		ownerId: string,
		query: PaymentMethodsQuery,
	): Promise<PaymentMethodCatalogItem[]> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const conditions = query.onlyActive ? [eq(paymentMethod.isActive, true)] : [];

				return tx
					.select({
						id: paymentMethod.id,
						code: paymentMethod.code,
						name: paymentMethod.name,
						isActive: paymentMethod.isActive,
					})
					.from(paymentMethod)
					.where(and(...conditions))
					.orderBy(asc(paymentMethod.name));
			});
		} catch (error) {
			throw toHttpException(error);
		}
	}

	/** Categorias de recibo del dueno, opcionalmente por direccion (`listCategories` del origen). */
	async receiptCategories(
		ownerId: string,
		query: ReceiptCategoriesQuery,
	): Promise<CashReceiptCategoryCatalogItem[]> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const conditions = [
					// `onlyActive` viene con default `true`: la lectura por defecto sigue siendo la de
					// siempre (solo activas). La tarjeta de configuracion pide `false` para poder
					// reactivar una categoria desactivada.
					...(query.onlyActive ? [eq(cashReceiptCategory.isActive, true)] : []),
					...(query.direction ? [eq(cashReceiptCategory.direction, query.direction)] : []),
				];

				return tx
					.select({
						id: cashReceiptCategory.id,
						direction: cashReceiptCategory.direction,
						name: cashReceiptCategory.name,
						code: cashReceiptCategory.code,
						isActive: cashReceiptCategory.isActive,
					})
					.from(cashReceiptCategory)
					.where(and(...conditions))
					.orderBy(asc(cashReceiptCategory.name));
			});
		} catch (error) {
			throw toHttpException(error);
		}
	}

	/**
	 * Siembra idempotente de las semillas del origen para el dueno de la sesion.
	 *
	 * Compara por `code`, que es unico por dueno (`payment_method_owner_id_code_key`,
	 * `cash_receipt_category_owner_id_code_key`) y es el identificador estable que usa la UI: si
	 * el dueno ya tiene una categoria renombrada, no se duplica; si le falta una semilla, se crea.
	 *
	 * Los `owner_id` no se escriben a mano: la columna tiene `default auth.uid()` y dentro de
	 * `withOwner` ese GUC es el dueno de la sesion, asi que es imposible sembrar para otro. El
	 * `onConflictDoNothing` cubre la carrera de dos requests simultaneos que vean el mismo hueco.
	 *
	 * Nota sobre el origen: su version ademas rellenaba el `code` de categorias viejas que lo
	 * tenian nulo. Aca no hace falta: en el esquema portado `code` es `not null` desde el DDL.
	 */
	async ensureDefaults(ownerId: string): Promise<CatalogSeedResult> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const existingMethods = await tx
					.select({ code: paymentMethod.code })
					.from(paymentMethod)
					.where(eq(paymentMethod.ownerId, ownerId));
				const methodCodes = new Set(existingMethods.map((row) => row.code));
				const missingMethods = DEFAULT_PAYMENT_METHODS.filter(
					(method) => !methodCodes.has(method.code),
				);

				const existingCategories = await tx
					.select({ code: cashReceiptCategory.code })
					.from(cashReceiptCategory)
					.where(eq(cashReceiptCategory.ownerId, ownerId));
				const categoryCodes = new Set(existingCategories.map((row) => row.code));
				const missingCategories = Object.entries(DEFAULT_CATEGORIES).flatMap(
					([direction, seeds]) =>
						seeds
							.filter((seed) => !categoryCodes.has(seed.code))
							.map((seed) => ({
								direction: direction as "INGRESO" | "EGRESO",
								code: seed.code,
								name: seed.name,
							})),
				);

				const createdMethods =
					missingMethods.length === 0
						? []
						: await tx
								.insert(paymentMethod)
								.values(missingMethods.map((method) => ({ ...method })))
								.onConflictDoNothing()
								.returning({ id: paymentMethod.id });

				const createdCategories =
					missingCategories.length === 0
						? []
						: await tx
								.insert(cashReceiptCategory)
								.values(missingCategories)
								.onConflictDoNothing()
								.returning({ id: cashReceiptCategory.id });

				return { methods: createdMethods.length, categories: createdCategories.length };
			});
		} catch (error) {
			throw toHttpException(error);
		}
	}

	/**
	 * `POST /payment-methods` — alta (`createPaymentMethod` del origen).
	 *
	 * El `code` llega ya normalizado por el schema compartido (trim, mayusculas, espacios a guion
	 * bajo, maximo 40). `owner_id` no viaja: la columna tiene `default auth.uid()` y dentro de
	 * `withOwner` ese GUC es el dueno de la sesion (S6). Un codigo repetido lo rechaza
	 * `unique (owner_id, code)` y `toCatalogHttpException` lo traduce a un 409 que nombra el codigo.
	 */
	async createPaymentMethod(
		ownerId: string,
		values: PaymentMethodBody,
	): Promise<PaymentMethodCatalogItem> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.insert(paymentMethod)
					.values({ code: values.code, name: values.name, isActive: values.isActive })
					.returning(METHOD_COLUMNS);
				const created = rows[0];

				if (!created) {
					throw new Error("El alta del metodo de pago no devolvio la fila creada.");
				}

				return created;
			});
		} catch (error) {
			throw toCatalogHttpException(error, "payment_method", values.code);
		}
	}

	/**
	 * `PATCH /payment-methods/:id` — modificacion (`updatePaymentMethod` del origen).
	 *
	 * Parcial y con el `code` INMUTABLE: solo viajan `name` e `isActive`, y solo los que el cliente
	 * mando (el origen aplicaba el mismo `if (values.x !== undefined)`). `updated_at` no existe en
	 * `payment_method`: la tabla solo tiene `created_at`.
	 *
	 * Un id inexistente o de otro dueno no matchea ninguna fila (la RLS ya la hace invisible) y
	 * responde 404, igual que la baja logica de una cuenta en C2.
	 */
	async updatePaymentMethod(
		ownerId: string,
		id: string,
		values: PaymentMethodPatch,
	): Promise<PaymentMethodCatalogItem> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const fields = partialMethodFields(values);
				const where = and(eq(paymentMethod.id, id), eq(paymentMethod.ownerId, ownerId));

				// Un PATCH vacio (`{}`) es un no-op valido: se lee la fila para poder responder 200 con
				// ella, o 404 si no es del dueno. No se llama a `.set({})`: un UPDATE sin columnas no es
				// SQL valido.
				const rows =
					Object.keys(fields).length === 0
						? await tx.select(METHOD_COLUMNS).from(paymentMethod).where(where).limit(1)
						: await tx
								.update(paymentMethod)
								.set(fields)
								.where(where)
								.returning(METHOD_COLUMNS);
				const updated = rows[0];

				if (!updated) {
					throw paymentMethodNotFound();
				}

				return updated;
			});
		} catch (error) {
			throw toCatalogHttpException(error, "payment_method", null);
		}
	}

	/**
	 * `POST /receipt-categories` — alta (`createCategory` del origen, `lib/caja/caja.ts:291-315`).
	 *
	 * El `code` NO viaja en el body: se DERIVA del nombre con `categoryCodeFromName`, y un nombre
	 * sin letras ni numeros se rechaza con el mensaje textual del origen ANTES de tocar la base
	 * (no hay slug que insertar). Es la unica regla de esta escritura que vive en Node, y vive aca
	 * porque es una derivacion, no una validacion de negocio: la columna es `not null`.
	 */
	async createReceiptCategory(
		ownerId: string,
		values: ReceiptCategoryBody,
	): Promise<CashReceiptCategoryCatalogItem> {
		const code = categoryCodeFromName(values.name);

		// Textual del origen (`lib/caja/caja.ts:294-298`): el usuario no ve el codigo, pero es el
		// identificador estable con el que el wizard resuelve categorias renombradas (SPEC 37).
		if (!code) {
			throw new BadRequestException(CATEGORY_EMPTY_CODE_MESSAGE);
		}

		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.insert(cashReceiptCategory)
					.values({
						direction: values.direction,
						name: values.name,
						code,
						isActive: values.isActive,
					})
					.returning(CATEGORY_COLUMNS);
				const created = rows[0];

				if (!created) {
					throw new Error("El alta de la categoria no devolvio la fila creada.");
				}

				return created;
			});
		} catch (error) {
			throw toCatalogHttpException(error, "cash_receipt_category", code);
		}
	}

	/**
	 * `PATCH /receipt-categories/:id` — modificacion (`updateCategory` del origen).
	 *
	 * Renombrar NO re-deriva el `code`: el origen lo creo justamente para que renombrar una
	 * categoria no rompa el wizard que la resuelve por codigo (SPEC 37). La `direction` tampoco
	 * cambia: no esta en el body.
	 */
	async updateReceiptCategory(
		ownerId: string,
		id: string,
		values: ReceiptCategoryPatch,
	): Promise<CashReceiptCategoryCatalogItem> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const fields = partialCategoryFields(values);
				const where = and(
					eq(cashReceiptCategory.id, id),
					eq(cashReceiptCategory.ownerId, ownerId),
				);

				// Mismo criterio que en el metodo de pago: un PATCH vacio lee y devuelve la fila.
				const rows =
					Object.keys(fields).length === 0
						? await tx
								.select(CATEGORY_COLUMNS)
								.from(cashReceiptCategory)
								.where(where)
								.limit(1)
						: await tx
								.update(cashReceiptCategory)
								.set(fields)
								.where(where)
								.returning(CATEGORY_COLUMNS);
				const updated = rows[0];

				if (!updated) {
					throw receiptCategoryNotFound();
				}

				return updated;
			});
		} catch (error) {
			throw toCatalogHttpException(error, "cash_receipt_category", null);
		}
	}
}

/** Las columnas de `PaymentMethodCatalogItem`, una sola vez para las dos escrituras. */
const METHOD_COLUMNS = {
	id: paymentMethod.id,
	code: paymentMethod.code,
	name: paymentMethod.name,
	isActive: paymentMethod.isActive,
};

/** Las columnas de `CashReceiptCategoryCatalogItem`: las MISMAS cinco de la lectura. */
const CATEGORY_COLUMNS = {
	id: cashReceiptCategory.id,
	direction: cashReceiptCategory.direction,
	name: cashReceiptCategory.name,
	code: cashReceiptCategory.code,
	isActive: cashReceiptCategory.isActive,
};

/**
 * Los campos de un PATCH de metodo de pago que el cliente efectivamente mando.
 *
 * `undefined` y no `null`: en Drizzle una clave ausente en `.set()` no se escribe. Es el mismo
 * `if (values.name !== undefined)` del origen, que dejaba intacto lo que no venia en el patch.
 */
function partialMethodFields(values: PaymentMethodPatch) {
	return {
		...(values.name === undefined ? {} : { name: values.name }),
		...(values.isActive === undefined ? {} : { isActive: values.isActive }),
	};
}

/** Idem para la categoria. */
function partialCategoryFields(values: ReceiptCategoryPatch) {
	return {
		...(values.name === undefined ? {} : { name: values.name }),
		...(values.isActive === undefined ? {} : { isActive: values.isActive }),
	};
}
