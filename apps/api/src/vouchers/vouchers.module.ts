// Modulo del vertical de ventas, slice 1: comprobantes de VENTA (T3).
//
// `DatabaseModule` es global, asi que el servicio solo pide el handle de Drizzle por token.
// `AuthModule` aporta `AUTH` y `SessionGuard`: Nest instancia las guardias del `@UseGuards` dentro
// del modulo que las declara, asi que sin este import la app no arranca —y sin imprimir nada, con
// exit 1—, igual que en `PaymentsModule`, `EntitiesModule` y `CashModule` (es la trampa que
// documenta el doc de la feature).
//
// Los slices siguientes del vertical (notas, retenciones, series y compras) agregan sus controllers
// y servicios a este mismo modulo, no a uno nuevo.
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { VouchersController } from "./vouchers.controller.ts";
import { VouchersService } from "./vouchers.service.ts";

@Module({
	imports: [AuthModule],
	controllers: [VouchersController],
	providers: [VouchersService],
})
export class VouchersModule {}
