// Prueba de que el borde de validacion es el contrato compartido (S8).
//
// El schema viene de `@gestion/shared` tal cual: el mismo que tipa el formulario del
// frontend. Este endpoint NO persiste nada (no usa la base ni `withOwner`), solo devuelve el
// payload ya parseado: transformaciones (`code` a mayusculas, defaults) y errores visibles.
// Es el smoke del pipe, no el inicio de un endpoint de escritura de pagos (T4 no los incluye).
import { Body, Controller, Post } from "@nestjs/common";
import { paymentSchema, type PaymentFormValues } from "@gestion/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";

export interface ValidatedPaymentResponse {
	valid: true;
	parsed: PaymentFormValues;
}

@Controller("contract")
export class ContractController {
	@Post("payments")
	validatePayment(
		@Body(new ZodValidationPipe(paymentSchema)) body: PaymentFormValues,
	): ValidatedPaymentResponse {
		return { valid: true, parsed: body };
	}
}
