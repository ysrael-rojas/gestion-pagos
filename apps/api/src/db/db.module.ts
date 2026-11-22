import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";
import {
	DATABASE,
	PG_POOL,
	createDatabase,
	createPool,
	type Database,
} from "./db.provider";

/**
 * Expone el handle de Drizzle a toda la app.
 *
 * Los constructores usan `@Inject(TOKEN)` explicito: el build es un bundle de esbuild, que no
 * emite `design:paramtypes` (`emitDecoratorMetadata`), asi que Nest no puede inferir tipos.
 */
@Global()
@Module({
	providers: [
		{ provide: PG_POOL, useFactory: (): Pool => createPool() },
		{
			provide: DATABASE,
			useFactory: (pool: Pool): Database => createDatabase(pool),
			inject: [PG_POOL],
		},
	],
	exports: [DATABASE, PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
	constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

	async onApplicationShutdown(): Promise<void> {
		await this.pool.end();
	}
}
