import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { CashModule } from "./cash/cash.module";
import { ContractModule } from "./contract/contract.module";
import { DatabaseModule } from "./db/db.module";
import { EntitiesModule } from "./entities/entities.module";
import { HealthModule } from "./health/health.module";
import { NotesModule } from "./notes/notes.module";
import { PaymentsModule } from "./payments/payments.module";
import { PurchasesModule } from "./purchases/purchases.module";
import { SeriesModule } from "./series/series.module";
import { VouchersModule } from "./vouchers/vouchers.module";

/**
 * `DatabaseModule` es global: expone el handle de Drizzle (y el pool) a todos los modulos.
 * `AuthModule`, `PaymentsModule`, `EntitiesModule`, `CashModule`, `VouchersModule`, `SeriesModule`,
 * `NotesModule` y `PurchasesModule` tocan la base; `ContractModule` es el smoke del pipe de validacion
 * y `HealthModule` no toca nada.
 *
 * `VouchersModule` va DESPUES de `PaymentsModule` a proposito: los dos publican rutas bajo
 * `/vouchers` (`GET /vouchers/open` es la cartera y `GET /vouchers/:id` el detalle de una venta) y
 * Express resuelve por orden de registro. Invertir el orden convierte la ruta de la cartera en un
 * 400 del parametro uuid; lo pina `apps/api/test/vouchers.e2e.test.ts`.
 *
 * `SeriesModule` publica `/series` y `/series/:id/delete`, que NO comparten prefijo con ningun otro
 * modulo, asi que su posicion no cambia el ruteo: va despues de `VouchersModule` porque es el otro
 * modulo del mismo vertical de ventas (la numeracion de esos comprobantes) y se lee en ese orden.
 *
 * `NotesModule` publica `/notes` y `/notes?voucherId=`, que tampoco comparten prefijo con otro modulo:
 * el detalle de una venta sigue siendo `GET /vouchers/:id` de `VouchersModule`, y las notas de ese
 * comprobante se leen en este modulo. Va ultimo del vertical de ventas por la misma razon que
 * `SeriesModule` (se lee en el orden del ciclo de emision: comprobante, serie, nota), no porque su
 * posicion afecte a nadie; lo pina `apps/api/test/notes.e2e.test.ts`, que comprueba que `GET
 * /vouchers/open` y `GET /vouchers/:id` siguen resolviendo igual.
 *
 * `PurchasesModule` publica `/purchases` y `/purchases/:id`, y NO comparte prefijo con ningun otro
 * modulo: `GET /vouchers/:id` sigue siendo el detalle de una venta y `GET /vouchers/open` la cartera,
 * asi que su posicion no puede cambiar el ruteo de nadie (Express resuelve por orden de registro, pero
 * solo compite por el mismo camino). Va despues de `NotesModule` porque es el otro lado del mostrador
 * y se lee al cerrar el ciclo del comprobante, no porque el orden importe. Lo pina
 * `apps/api/test/purchases.e2e.test.ts`, que comprueba que una venta con el mismo numero no aparece en
 * el listado de compras ni bloquea su alta (S2).
 */
@Module({
	imports: [
		DatabaseModule,
		AuthModule,
		PaymentsModule,
		EntitiesModule,
		CashModule,
		VouchersModule,
		SeriesModule,
		NotesModule,
		PurchasesModule,
		ContractModule,
		HealthModule,
	],
})
export class AppModule {}
