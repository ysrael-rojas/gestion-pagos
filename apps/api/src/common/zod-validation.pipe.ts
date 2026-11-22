// Pipe de validacion Zod (S8).
//
// El contrato no se duplica: los mismos schemas de `@gestion/shared` que tipan el frontend
// validan el borde del API. No hay DTOs de clase ni `class-validator`, asi que la validacion
// no depende de `design:paramtypes` (que el bundle no emite).
//
// El error devuelto es 400 con los `issues` de Zod (`path` + `message`), que son los mismos
// mensajes en espanol que ya muestra el formulario del frontend.
import { BadRequestException, type ArgumentMetadata, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

export interface ZodIssueDetail {
	path: string;
	message: string;
	code: string;
}

export class ZodValidationPipe<T extends ZodType> implements PipeTransform {
	constructor(private readonly schema: T) {}

	transform(value: unknown, _metadata: ArgumentMetadata): unknown {
		const result = this.schema.safeParse(value);

		if (!result.success) {
			const issues: ZodIssueDetail[] = result.error.issues.map((issue) => ({
				path: issue.path.join("."),
				message: issue.message,
				code: issue.code,
			}));

			throw new BadRequestException({
				statusCode: 400,
				error: "Bad Request",
				message: "El payload no cumple el contrato compartido.",
				issues,
			});
		}

		return result.data;
	}
}
