// Modulo de cajas y bancos (C1: ajustes generales).
//
// `DatabaseModule` es global, asi que el servicio solo pide el handle de Drizzle por token.
// `AuthModule` aporta `AUTH` y `SessionGuard`: Nest instancia las guardias del `@UseGuards`
// dentro del modulo que las declara, asi que sin este import la app no arranca
// (UnknownDependenciesException con `Symbol(AUTH)`), igual que en `PaymentsModule` y
// `EntitiesModule`.
//
// Los slices siguientes del vertical (cuentas, posiciones, cierres, caja chica, conciliacion)
// agregan sus controllers y servicios a este mismo modulo, no a uno nuevo.
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsController } from "./settings.controller.ts";
import { SettingsService } from "./settings.service.ts";

@Module({
	imports: [AuthModule],
	controllers: [SettingsController],
	providers: [SettingsService],
})
export class CashModule {}
