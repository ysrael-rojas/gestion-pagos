import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { CashModule } from "./cash/cash.module";
import { ContractModule } from "./contract/contract.module";
import { DatabaseModule } from "./db/db.module";
import { EntitiesModule } from "./entities/entities.module";
import { HealthModule } from "./health/health.module";
import { PaymentsModule } from "./payments/payments.module";

/**
 * `DatabaseModule` es global: expone el handle de Drizzle (y el pool) a todos los modulos.
 * `AuthModule`, `PaymentsModule`, `EntitiesModule` y `CashModule` tocan la base; `ContractModule`
 * es el smoke del pipe de validacion y `HealthModule` no toca nada.
 */
@Module({
	imports: [
		DatabaseModule,
		AuthModule,
		PaymentsModule,
		EntitiesModule,
		CashModule,
		ContractModule,
		HealthModule,
	],
})
export class AppModule {}
