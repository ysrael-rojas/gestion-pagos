// Contratos de salida del vertical de series (T3 del port de series, S10).
//
// La fila la define `voucherSeriesSchema` en `packages/shared`, no este modulo: es el mismo
// contrato que tipa la tabla de Configuración → Series y el que cierra el drift que anoto L8 del
// slice 1 (`lastNumber` no estaba en el schema del formulario). Se reexporta desde aca para que
// controller y servicio hablen del tipo del vertical sin importar la ruta interna del paquete
// compartido dos veces.
//
// `PATCH /series/:id` devuelve la MISMA fila (no un eco del body): `lastNumber` no viaja en el
// body y la respuesta lo tiene que traer igual, porque la tabla lo muestra.
import type { VoucherSeriesRow } from "@gestion/shared/lib/schemas/serie.ts";

export type { VoucherSeriesRow };
