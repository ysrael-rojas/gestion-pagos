// Modulo de cajas y bancos (C1: ajustes generales; C2: cuentas; C3: posiciones; C4: cierres y
// arqueos; C6: transferencias y caja chica; C7: conciliacion bancaria y flujo de caja).
//
// `DatabaseModule` es global, asi que el servicio solo pide el handle de Drizzle por token.
// `AuthModule` aporta `AUTH` y `SessionGuard`: Nest instancia las guardias del `@UseGuards`
// dentro del modulo que las declara, asi que sin este import la app no arranca
// (UnknownDependenciesException con `Symbol(AUTH)`), igual que en `PaymentsModule` y
// `EntitiesModule`.
//
// Los slices siguientes del vertical (configuracion) agregan sus controllers y servicios a este
// mismo modulo, no a uno nuevo.
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { BankReconciliationsController } from "./bank-reconciliations.controller.ts";
import { BankReconciliationsService } from "./bank-reconciliations.service.ts";
import { CashAccountsController } from "./cash-accounts.controller.ts";
import { CashAccountsService } from "./cash-accounts.service.ts";
import { CashFlowController } from "./cash-flow.controller.ts";
import { CashFlowService } from "./cash-flow.service.ts";
import { CashTransfersController } from "./cash-transfers.controller.ts";
import { CashTransfersService } from "./cash-transfers.service.ts";
import { ClosesController } from "./closes.controller.ts";
import { ClosesService } from "./closes.service.ts";
import { PettyCashController } from "./petty-cash.controller.ts";
import { PettyCashService } from "./petty-cash.service.ts";
import { PositionsController } from "./positions.controller.ts";
import { PositionsService } from "./positions.service.ts";
import { SettingsController } from "./settings.controller.ts";
import { SettingsService } from "./settings.service.ts";

@Module({
	imports: [AuthModule],
	controllers: [
		SettingsController,
		CashAccountsController,
		PositionsController,
		ClosesController,
		CashTransfersController,
		PettyCashController,
		BankReconciliationsController,
		CashFlowController,
	],
	providers: [
		SettingsService,
		CashAccountsService,
		PositionsService,
		ClosesService,
		CashTransfersService,
		PettyCashService,
		BankReconciliationsService,
		CashFlowService,
	],
})
export class CashModule {}
