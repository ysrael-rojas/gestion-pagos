// Catalogos del vertical de pagos: las cuatro lecturas que necesita el formulario de alta mas el
// sembrado explicito de las semillas del origen.
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
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database } from "../db/db.provider";
import { cashAccount, cashReceiptCategory, entidad, paymentMethod } from "../db/schema";
import { withOwner } from "../db/with-owner";
import { DEFAULT_CATEGORIES, DEFAULT_PAYMENT_METHODS } from "./catalogs.defaults.ts";
import type {
	CashAccountCatalogItem,
	CashReceiptCategoryCatalogItem,
	CatalogSeedResult,
	EntityCatalogItem,
	PaymentMethodCatalogItem,
} from "./catalogs.types.ts";
import type { EntitiesQuery, PaymentMethodsQuery, ReceiptCategoriesQuery } from "./catalogs.query.ts";
import { toHttpException } from "./payments.errors.ts";

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
					eq(cashReceiptCategory.isActive, true),
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

}
