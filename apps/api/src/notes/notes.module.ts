// Modulo del vertical notas (T3 del port de notas).
//
// `DatabaseModule` es global, asi que el servicio solo pide el handle de Drizzle por token.
// `AuthModule` aporta `AUTH` y `SessionGuard`: Nest instancia las guardias del `@UseGuards` dentro del
// modulo que las declara, asi que sin este import la app no arranca —y sin imprimir nada, con exit
// 1—, igual que en `VouchersModule`, `SeriesModule`, `PaymentsModule`, `EntitiesModule` y
// `CashModule`.
//
// Es un modulo APARTE de `VouchersModule` y no un controller mas ahi: la nota es otro recurso (su
// alta tiene su propia RPC, su propio mapa de errores y su propio contrato de fila) y el prefijo
// `notes` no comparte nada con `/vouchers`, que ya se atiende en otro modulo con una regla de orden
// de registro. Lo que los une es la tabla `comprobante`, que este modulo lee y escribe SOLO por la
// RPC `public.crear_nota`.
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotesController } from "./notes.controller.ts";
import { NotesService } from "./notes.service.ts";

@Module({
	imports: [AuthModule],
	controllers: [NotesController],
	providers: [NotesService],
})
export class NotesModule {}
