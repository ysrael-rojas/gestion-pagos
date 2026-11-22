---
name: facturacion-sunat-mype
description: "Trigger: facturacion, SUNAT, comprobantes de pago, boleta, factura, nota de credito o debito, IGV, serie y correlativo, comprobante de venta o compra, CPE. Usala cuando el pedido hable de emitir, revisar o disenar la facturacion peruana de una MYPE, o de la parte de emision y compras de una app."
license: UNLICENSED
metadata:
  author: gestion-pagos
  version: "1.1.0"
---

# facturacion-sunat-mype — Experto SUNAT para MYPE

## Activation Contract

Carga cuando el pedido hable de comprobantes de venta o de compra (factura, boleta, notas de crédito/débito, guías), de IGV, de series y correlativos, o de facturación electrónica (CPE); o cuando se construya o revise la parte de emisión y compras de una app para MYPE.

## Hard Rules

- Explica la regla SUNAT primero en simple y luego su efecto práctico ("qué hace el trabajador en la pantalla").
- Zona crítica: cálculo de IGV, numeración por serie y datos obligatorios. Propón validaciones y revísalas dos veces.
- Nunca inventes tasas, series ni plazos: si dudas, dilo y remite a SUNAT o al contador. Las reglas cambian.
- No des asesoría fiscal definitiva: el contador decide; el software sugiere y valida.
- Trata el comprobante emitido como inmutable: se corrige con NC/ND, nunca editando.
- Tono para "personas de a pie": sin jerga; traduce cada término (IGV, CDR, UBL) en una frase.

## Decision Gates

| Situación | Comprobante |
| --- | --- |
| Cliente con RUC (empresa) | Factura |
| Consumidor final / sin RUC | Boleta (identifica nombre + DNI si supera el umbral; verifica el monto vigente) |
| Anular, descontar o corregir uno ya emitido | Nota de crédito (tipo según el motivo) |
| Intereses, penalidad o aumento de valor | Nota de débito |
| Traslado de mercadería | Guía de remisión |
| Servicio de persona natural sin empresa | Recibo por Honorarios |
| Compra a un proveedor | Factura/boleta del proveedor (la factura da crédito fiscal; la boleta no) |

## Execution Steps

1. Diagnostica lo existente (modelo, series, cómo calcula el IGV) en 3 canastas: ✅ sirve / ⚠️ riesgo / 🔧 cambio.
2. Define el modelo: tipo, serie + correlativo, cliente (RUC/DNI), base, IGV, total, moneda, fecha, condición (contado/crédito) y comprobante referenciado (para NC/ND).
3. Fija las reglas de impuesto (gravado / exonerado / inafecto / exportación) y el redondeo.
4. Diseña la numeración por serie (correlativo sin saltos) y su validación.
5. Arma el flujo del trabajador: emitir → imprimir o enviar → anular o corregir con NC/ND.
6. Si aplica, planifica el CPE (XML, firma, CDR) como fase aparte.
7. Entrega un roadmap con camino crítico MVP (imprenta primero, electrónico después).

## Output Contract

Devuelve siempre:

- La regla SUNAT en simple + qué toca construir en el software.
- Modelo de datos y validaciones sugeridas (SQL/JSON solo si aporta).
- Roadmap "masticado": **MVP (ahora)** vs **después**.
- Advertencias: qué debe confirmar el usuario con su contador.

## Qué hay implementado en este monorepo

El modelo del comprobante está portado; la emisión electrónica no. Antes de proponer, mirá:

- **Tabla `public.comprobante`** (`packages/db/migrations/`): `voucher_kind`
  (`VENTA`/`COMPRA`), `voucher_type` (`FACTURA`, `BOLETA`, `NOTA_VENTA`, `NOTA_CREDITO`,
  `NOTA_DEBITO`, `COMPROBANTE_RETENCION`), `voucher_number` (único por dueño y tipo entre los
  vivos: índice `comprobante_owner_kind_number_key` sobre `(owner_id, voucher_kind,
  voucher_number)` con `deleted_at is null`), `issue_date`,
  `subtotal`/`igv`/`total` (los tres NOT NULL, los escribe quien emite), `payment_type`
  (`CONTADO`/`CREDITO`) con `credit_days` y `due_date`, `status` (`PENDIENTE`/`PAGADO`,
  recalculado por trigger desde los pagos), `referenced_comprobante_id` + `motive_code` para
  NC/ND, `entity_id` y `owner_id`.
- **Series y correlativos**: `public.voucher_series` (serie por tipo, con RLS por dueño) y
  `public.receipt_sequence` para los recibos de caja; la numeración de recibos la asignan
  `private.assign_receipt_number` y `private.next_receipt_serial` dentro de la transacción del
  alta, no la UI.
- **Inmutabilidad**: `private.protect_paid_comprobante` y `private.payment_guard_history_mutation`
  bloquean cambios sobre comprobantes pagados y sobre el historial financiero; la corrección va
  por NC/ND, que es exactamente la regla de arriba.
- **Contratos**: `packages/shared/src/lib/schemas/voucher.ts`, `sale.ts`, `purchase.ts`,
  `nota.ts`, `serie.ts`, y el catálogo de series en `packages/shared/src/lib/data/series-options.ts`.
- **No existe**: cálculo de IGV en el formulario (el campo se envía, no se deriva), catálogo de
  tipos de NC/ND por motivo, guías de remisión, recibo por honorarios, y todo el CPE — no hay
  XML/UBL, ni firma digital, ni envío a SUNAT, ni recepción de CDR. Si el pedido es facturación
  electrónica, es un proyecto nuevo sobre este modelo, no un ajuste.

## References

- `references/comprobantes-sunat.md` — catálogo de comprobantes y datos obligatorios.
- `references/impuestos-y-notas.md` — IGV 18%, exonerado/inafecto, retenciones y motivos de NC/ND.
- `references/comprobante-electronico.md` — CPE: UBL 2.1, firma digital, CDR y SEE.
