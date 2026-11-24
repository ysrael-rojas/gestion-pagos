import { z } from "zod";

import type { AdjustmentVoucherType, NoteVoucherType } from "../data/nota-options.ts";
import {
  ADJUSTMENT_VOUCHER_TYPES,
  NOTE_MOTIVES,
} from "../data/nota-options.ts";
import { voucherNumberSchema } from "./voucher.ts";

const voucherTypeEnum = z.enum(
  ADJUSTMENT_VOUCHER_TYPES.map((option) => option.value) as [
    AdjustmentVoucherType,
    ...AdjustmentVoucherType[],
  ],
  { error: "Selecciona el tipo de comprobante" }
);

/**
 * Contrato del formulario y del body. El numero lo asigna la base desde la serie del tipo de nota
 * (`odd/tasks/port-vertical-notas.md`, S3), asi que el body no lo exige; el formulario lo muestra
 * como preview de solo lectura y lo manda igual.
 */
function notaContract<T extends z.ZodType>(voucherNumber: T) {
  return z
    .object({
      issueDate: z.string().min(1, "La fecha de emisión es requerida"),
      voucherType: voucherTypeEnum,
      voucherNumber,
      total: z.coerce
        .number({ error: "Ingresa un total válido" })
        .positive("El total debe ser mayor a 0"),
      motiveCode: z.string().optional(),
      referencedComprobanteId: z
        .string()
        .min(1, "Selecciona el comprobante referenciado"),
    })
    .superRefine((values, ctx) => {
      // El tipo se castea porque el schema se arma con un generico para el numero (el body no lo
      // exige): la inferencia del objeto pierde el literal del enum dentro del refine.
      const tipo = values.voucherType as AdjustmentVoucherType;

      if (tipo === "COMPROBANTE_RETENCION") {
        if (values.motiveCode) {
          ctx.addIssue({
            code: "custom",
            path: ["motiveCode"],
            message: "El comprobante de retención no lleva motivo",
          });
        }
        return;
      }

      if (!values.motiveCode) {
        ctx.addIssue({
          code: "custom",
          path: ["motiveCode"],
          message: "Selecciona el motivo de la nota",
        });
        return;
      }

      const motives = NOTE_MOTIVES[tipo as NoteVoucherType];
      if (!motives.some((motive) => motive.value === values.motiveCode)) {
        ctx.addIssue({
          code: "custom",
          path: ["motiveCode"],
          message: "El motivo no pertenece al catálogo de la nota",
        });
      }
    });
}

/** Formulario de alta: el numero viaja (preview), por eso lo exige igual que un comprobante. */
export const notaSchema = notaContract(voucherNumberSchema);

/** Body del API: el numero lo asigna la base; si llega, se ignora. */
export const notaWriteSchema = notaContract(z.string().optional());

export type NotaFormValues = z.output<typeof notaSchema>;
export type NotaFormInput = z.input<typeof notaSchema>;
export type NotaWriteValues = z.output<typeof notaWriteSchema>;

/**
 * Fila de nota que lista el detalle de un comprobante (`GET /vouchers/:id/notes`).
 *
 * La retencion no entra: tiene su propio slice y no lleva motivo
 * (`odd/tasks/port-vertical-notas.md`, S1).
 */
export const voucherAdjustmentSchema = z.object({
  id: z.string().uuid(),
  voucherType: z.enum(["NOTA_CREDITO", "NOTA_DEBITO"]),
  voucherNumber: z.string().min(1),
  issueDate: z.string().min(1),
  motiveCode: z.string().nullable(),
  total: z.number(),
});

export type VoucherAdjustmentRow = z.output<typeof voucherAdjustmentSchema>;
