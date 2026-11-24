import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { CashModule } from "./cash/cash.module";
import { ContractModule } from "./contract/contract.module";
import { DatabaseModule } from "./db/db.module";
import { EntitiesModule } from "./entities/entities.module";
import { HealthModule } from "./health/health.module";
import { PaymentsModule } from "./payments/payments.module";
import { SeriesModule } from "./series/series.module";
import { VouchersModule } from "./vouchers/vouchers.module";

/**
 * `DatabaseModule` es global: expone el handle de Drizzle (y el pool) a todos los modulos.
 * `AuthModule`, `PaymentsModule`, `EntitiesModule`, `CashModule`, `VouchersModule` y `SeriesModule`
 * tocan la base; `ContractModule` es el smoke del pipe de validacion y `HealthModule` no toca nada.
 *
 * `VouchersModule` va DESPUES de `PaymentsModule` a proposito: los dos publican rutas bajo
 * `/vouchers` (`GET /vouchers/open` es la cartera y `GET /vouchers/:id` el detalle de una venta) y
 * Express resuelve por orden de registro. Invertir el orden convierte la ruta de la cartera en un
 * 400 del parametro uuid; lo pina `apps/api/test/vouchers.e2e.test.ts`.
 *
 * `SeriesModule` publica `/series` y `/series/:id/delete`, que NO comparten prefijo con ningun otro
 * modulo, asi que su posicion no cambia el ruteo: va despues de `VouchersModule` porque es el otro
 * modulo del mismo vertical de ventas (la numeracion de esos comprobantes) y se lee en ese orden.
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
		ContractModule,
		HealthModule,
	],
})
export class AppModule {}
