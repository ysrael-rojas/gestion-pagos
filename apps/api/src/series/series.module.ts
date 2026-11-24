// Modulo del vertical de series de comprobante (T3 del port de series).
//
// `DatabaseModule` es global, asi que el servicio solo pide el handle de Drizzle por token.
// `AuthModule` aporta `AUTH` y `SessionGuard`: Nest instancia las guardias del `@UseGuards` dentro
// del modulo que las declara, asi que sin este import la app no arranca —y sin imprimir nada, con
// exit 1—, igual que en `VouchersModule`, `PaymentsModule`, `EntitiesModule` y `CashModule`.
//
// Es un modulo APARTE de `VouchersModule` y no un controller mas ahi: `vouchers` es el comprobante
// y `series` es la numeracion, y el prefijo de la ruta (`series`) ya es distinto. Lo que los une es
// la tabla `voucher_series`, que este modulo lee y escribe por las RPC de
// `20261125090000_series_rpcs.sql`.
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SeriesController } from "./series.controller.ts";
import { SeriesService } from "./series.service.ts";

@Module({
	imports: [AuthModule],
	controllers: [SeriesController],
	providers: [SeriesService],
})
export class SeriesModule {}
