// Modulo del vertical de compras (T3).
//
// `DatabaseModule` es global, asi que el servicio solo pide el handle de Drizzle por token.
// `AuthModule` aporta `AUTH` y `SessionGuard`: Nest instancia las guardias del `@UseGuards` dentro del
// modulo que las declara, asi que sin este import la app no arranca —y sin imprimir nada, con exit
// 1—, igual que en `PaymentsModule`, `EntitiesModule`, `CashModule` y `VouchersModule`.
//
// Modulo PROPIO y no una rama de `VouchersModule`: el vertical de compras tiene sus RPC, sus mensajes
// (S8) y su contrato de escritura (el numero viaja, S2). Lo que comparte con ventas es la tabla
// unificada (`db/schema/comprobante.ts`, que ya tiene `voucher_kind`) y el tipo de salida, y eso se
// comparte importando, no metiendo las dos cosas en el mismo modulo.
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.ts";
import { PurchasesController } from "./purchases.controller.ts";
import { PurchasesService } from "./purchases.service.ts";

@Module({
	imports: [AuthModule],
	controllers: [PurchasesController],
	providers: [PurchasesService],
})
export class PurchasesModule {}
