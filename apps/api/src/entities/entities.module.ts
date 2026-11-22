// Modulo del vertical de clientes (T5c).
//
// `DatabaseModule` es global, asi que el servicio solo pide el handle de Drizzle por token.
// `AuthModule` aporta `AUTH` y `SessionGuard`: Nest instancia las guardias del `@UseGuards`
// dentro del modulo que las declara, asi que sin este import la app no arranca
// (UnknownDependenciesException con `Symbol(AUTH)`), igual que en `PaymentsModule`.
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EntitiesController } from "./entities.controller.ts";
import { EntitiesService } from "./entities.service.ts";

@Module({
	imports: [AuthModule],
	controllers: [EntitiesController],
	providers: [EntitiesService],
})
export class EntitiesModule {}
