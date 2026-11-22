// Prueba de comportamiento del pipe de validacion (S8).
//
// Importa el schema REAL de `@gestion/shared` (`packages/shared/src/lib/schemas/payment.ts`)
// para que lo verificado sea el contrato compartido y no una copia: si el schema cambia, este
// test cambia de resultado. El pipe se ejercita por su interfaz publica (`transform`), sin
// mirar su implementacion.
import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, type ArgumentMetadata } from "@nestjs/common";
import { paymentSchema } from "../../../packages/shared/src/lib/schemas/payment.ts";
import { ZodValidationPipe } from "../src/common/zod-validation.pipe.ts";

type PaymentFormValues = ReturnType<typeof paymentSchema.parse>;

const metadata: ArgumentMetadata = { type: "body" };

const pipe = new ZodValidationPipe(paymentSchema);

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

function validPayload() {
	return {
		entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		direction: "INGRESO",
		paymentDate: "2026-10-30",
		amount: "1250.50",
		methodId: VALID_UUID,
		cashAccountId: "22222222-2222-4222-8222-222222222222",
		categoryId: "33333333-3333-4333-8333-333333333333",
		allocations: [{ comprobanteId: "44444444-4444-4444-8444-444444444444", amount: "250" }],
	};
}

interface BadRequestBody {
	statusCode: number;
	message: string;
	issues: Array<{ path: string; message: string; code: string }>;
}

/** Devuelve el cuerpo 400 que el pipe produjo, fallando si no es un BadRequestException. */
function expectBadRequest(run: () => unknown): BadRequestBody {
	let captured: unknown;

	try {
		run();
	} catch (error) {
		captured = error;
	}

	assert.ok(captured instanceof BadRequestException, "el pipe debe lanzar BadRequestException");
	assert.equal(captured.getStatus(), 400);

	return captured.getResponse() as BadRequestBody;
}

test("acepta un payload del contrato compartido y devuelve los valores parseados", () => {
	const parsed = pipe.transform(validPayload(), metadata) as PaymentFormValues;

	// Transformaciones observables del schema compartido: `amount` coercido a numero y
	// asignaciones normalizadas.
	assert.equal(parsed.amount, 1250.5);
	assert.deepEqual(parsed.allocations, [
		{ comprobanteId: "44444444-4444-4444-8444-444444444444", amount: 250 },
	]);
	assert.equal(parsed.direction, "INGRESO");
	assert.equal(parsed.paymentDate, "2026-10-30");
});

test("aplica el default `allocations: []` del contrato cuando el campo no viene", () => {
	const payload = validPayload();
	const { allocations: _ignored, ...withoutAllocations } = payload;

	const parsed = pipe.transform(withoutAllocations, metadata) as PaymentFormValues;

	assert.deepEqual(parsed.allocations, []);
});

test("rechaza un id que no es uuid con el mensaje del contrato y sin tocar datos", () => {
	const before = validPayload();
	const body = expectBadRequest(() =>
		pipe.transform({ ...before, methodId: "no-es-un-uuid" }, metadata),
	);

	assert.equal(body.statusCode, 400);
	assert.deepEqual(
		body.issues.map((issue) => [issue.path, issue.message]),
		[["methodId", "Selecciona un método de pago."]],
	);
	// El pipe no muta la entrada: el payload original queda igual.
	assert.equal(before.methodId, VALID_UUID);
});

test("rechaza asignaciones que superan el importe", () => {
	const payload = { ...validPayload(), amount: "100" };

	const body = expectBadRequest(() => pipe.transform(payload, metadata));

	assert.deepEqual(
		body.issues.map((issue) => [issue.path, issue.message]),
		[["allocations", "Las asignaciones no pueden superar el importe del pago."]],
	);
});

test("rechaza asignaciones sin entidad", () => {
	const { entityId: _ignored, ...payload } = validPayload();

	const body = expectBadRequest(() => pipe.transform(payload, metadata));

	assert.deepEqual(
		body.issues.map((issue) => [issue.path, issue.message]),
		[["entityId", "Selecciona la entidad para asignar el pago."]],
	);
});

test("rechaza un importe no positivo", () => {
	// Sin asignaciones, para que el unico issue sea el del importe: con asignaciones el
	// `superRefine` del contrato agrega tambien "las asignaciones no pueden superar el importe".
	const { allocations: _ignored, ...payload } = validPayload();

	const body = expectBadRequest(() => pipe.transform({ ...payload, amount: "0" }, metadata));

	assert.deepEqual(
		body.issues.map((issue) => [issue.path, issue.message]),
		[["amount", "El importe debe ser mayor a 0."]],
	);
});
