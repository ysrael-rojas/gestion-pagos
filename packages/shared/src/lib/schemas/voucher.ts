import { z } from "zod";

import type {
  PaymentType,
  VoucherStatus,
  VoucherType,
} from "../../components/comprobantes/types";
import {
  PAYMENT_TYPES,
  SALE_STATUSES,
  VOUCHER_TYPES,
} from "../data/sale-options.ts";

/**
 * Serie + correlativo del comprobante (SUNAT): hasta 4 caracteres alfanuméricos de
 * serie, un guion y el correlativo numérico. Ejemplo: `F001-000001`.
 * Se valida solo en la app: un CHECK en la base rompería comprobantes históricos.
 */
export const VOUCHER_NUMBER_PATTERN = /^[A-Za-z0-9]{1,4}-\d{1,8}$/;

/**
 * Número de comprobante: recorta espacios y exige el formato serie-correlativo.
 * Compartido por ventas, compras, notas y retenciones.
 */
export const voucherNumberSchema = z
  .string()
  .trim()
  .min(1, "El número de comprobante es requerido")
  .regex(
    VOUCHER_NUMBER_PATTERN,
    "Usa el formato serie-correlativo, por ejemplo F001-000001"
  );

const voucherTypeEnum = z.enum(
  VOUCHER_TYPES.map((option) => option.value) as [
    VoucherType,
    ...VoucherType[],
  ],
  { error: "Selecciona el tipo de comprobante" }
);

const paymentTypeEnum = z.enum(
  PAYMENT_TYPES.map((option) => option.value) as [PaymentType, ...PaymentType[]],
  { error: "Selecciona el tipo de pago" }
);

const voucherStatusEnum = z.enum(
  SALE_STATUSES.map((option) => option.value) as [
    VoucherStatus,
    ...VoucherStatus[],
  ],
  { error: "Selecciona el estado" }
);

/**
 * En CONTADO los dias de credito no existen; en CREDITO son obligatorios (lo exige el
 * `superRefine` del contrato y el CHECK `comprobante_credit_days` de la base). Vive en su propia
 * funcion para que las dos variantes del contrato (formulario y escritura) normalicen igual.
 */
function normaliseCreditDays(
  paymentType: PaymentType,
  creditDays: number | null | undefined
): number | null {
  return paymentType === "CREDITO" ? (creditDays ?? null) : null;
}

/**
 * El CONTRATO DE SALIDA del comprobante, escrito una sola vez.
 *
 * Existe porque `voucherContract` es generica en `voucherNumber` y `transform` es una funcion
 * dentro de una funcion generica: ahi TypeScript infiere la rama `null` de `creditDays` fuera del
 * tipo y `VoucherFormValues["creditDays"]` quedaba en `number`, rompiendo el typecheck de la web
 * (que compara el OUTPUT del schema con su propio INPUT). Anotar el callback de `transform` con
 * este tipo fija `creditDays: number | null`, que es lo que el formulario entrega de verdad y lo
 * que el API recibe.
 */
type VoucherContractValues<TNumber> = {
  issueDate: string;
  voucherType: VoucherType;
  voucherNumber: TNumber;
  entityId: string;
  total: number;
  paymentType: PaymentType;
  creditDays: number | null;
  status: VoucherStatus;
};

/**
 * Schema unico del comprobante de venta y compra: valor del formulario y contrato de escritura del
 * API salen de aca. Usa el campo `entityId` para cliente o proveedor; la vista lo mapea al payload
 * de cada modulo (`entityId` en ventas, `supplierId` en compras).
 *
 * POR QUE DOS VARIANTES CON UNA SOLA DEFINICION (S2 del port de series): el formulario sigue
 * pidiendo `voucherNumber` —lo muestra como preview de solo lectura del numero que la base
 * asignara, S11—, pero el API ya no puede exigirlo: el numero lo asigna la base desde la serie por
 * defecto del tipo, dentro de la transaccion del alta. La UNICA diferencia entre las dos variantes
 * es ese campo; los campos, el `superRefine` y la normalizacion de `creditDays` son los mismos, asi
 * que el formulario y el API no pueden validar cosas distintas.
 */
function voucherContract<TSerial extends z.ZodType>(voucherNumber: TSerial) {
  return z
    .object({
      issueDate: z.string().min(1, "La fecha de emisión es requerida"),
      voucherType: voucherTypeEnum,
      voucherNumber,
      entityId: z.string().min(1, "Selecciona el cliente o proveedor"),
      total: z.coerce
        .number({ error: "Ingresa un total válido" })
        .positive("El total debe ser mayor a 0"),
      paymentType: paymentTypeEnum,
      creditDays: z.preprocess(
        // `null` cuenta como ausente, igual que `""`: es lo que el propio schema devuelve en CONTADO,
        // y aceptarlo hace que su output vuelva a entrar como input (L13 del doc de la feature).
        // `z.coerce.number(null)` daria 0 y romperia el `min(1)`, o sea un 400 en cada venta de
        // contado que se postee con el resultado del formulario.
        (value) => (value === "" || value === null ? undefined : value),
        z.coerce
          .number({ error: "Ingresa un número válido de días" })
          .int("Los días de crédito deben ser un número entero")
          .min(1, "Los días de crédito deben ser al menos 1")
          .optional()
      ),
      status: voucherStatusEnum,
    })
    .superRefine((values, ctx) => {
      if (values.paymentType === "CREDITO" && values.creditDays == null) {
        ctx.addIssue({
          code: "custom",
          path: ["creditDays"],
          message: "Ingresa los días de crédito",
        });
      }
    })
    /**
     * Los días de crédito existen **solo** en `CREDITO`; en `CONTADO` van como
     * `null` aunque el formulario mande el valor viejo (arranca en 30 al elegir
     * Crédito). El CHECK `comprobante_credit_days` de la base ya lo exige, así que
     * limpiarlo acá evita el 400 genérico de la base. Ver S3.
     */
    .transform((raw): VoucherContractValues<z.output<TSerial>> => {
      // El output de la cadena es un tipo mapeado sobre una forma que depende de `TSerial`, y en
      // este contexto TypeScript no puede desplegar sus campos (`...raw`). Se reafirma lo que la
      // forma de arriba ya declara: ninguna regla se relaja, `superRefine` valido esos campos.
      const values = raw as VoucherContractValues<z.output<TSerial>>;

      return {
        ...values,
        creditDays: normaliseCreditDays(values.paymentType, values.creditDays),
      };
    });
}

/** Contrato del FORMULARIO: el número de comprobante es obligatorio (preview). */
export const voucherFormSchema = voucherContract(voucherNumberSchema);

/**
 * Contrato de ESCRITURA del API (`POST /vouchers`, `PATCH /vouchers/:id`).
 *
 * `voucherNumber` deja de ser un dato del cliente: lo asigna la base desde la serie
 * por defecto del tipo, en la misma transacción que escribe el comprobante (S2).
 * Se acepta y se IGNORA mientras la pantalla lo siga mandando (T5 lo saca del
 * cliente); no se valida su formato porque ya no significa nada.
 */
export const voucherWriteSchema = voucherContract(z.string().optional());

export type VoucherFormValues = z.output<typeof voucherFormSchema>;
export type VoucherFormInput = z.input<typeof voucherFormSchema>;
export type VoucherWriteValues = z.output<typeof voucherWriteSchema>;
