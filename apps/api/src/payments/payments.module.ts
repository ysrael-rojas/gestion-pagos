import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CarteraController } from "./cartera.controller";
import { CarteraService } from "./cartera.service";
import { CatalogsController } from "./catalogs.controller.ts";
import { CatalogsService } from "./catalogs.service.ts";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

// Vertical de pagos: pagos (lectura y escritura) + cartera + comprobantes abiertos + los
// catalogos que necesita el formulario de alta (entidades, cuentas, metodos y categorias).
// `AuthModule` aporta `AUTH` y `SessionGuard`, que es lo que protege las tres superficies.
@Module({
	imports: [AuthModule],
	controllers: [PaymentsController, CarteraController, CatalogsController],
	providers: [PaymentsService, CarteraService, CatalogsService],
})
export class PaymentsModule {}
