import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CarteraController } from "./cartera.controller";
import { CarteraService } from "./cartera.service";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

// Vertical de pagos: pagos (lectura y escritura) + cartera + comprobantes abiertos.
// `AuthModule` aporta `AUTH` y `SessionGuard`, que es lo que protege las dos superficies.
@Module({
	imports: [AuthModule],
	controllers: [PaymentsController, CarteraController],
	providers: [PaymentsService, CarteraService],
})
export class PaymentsModule {}
