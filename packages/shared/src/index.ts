// Punto de entrada de @gestion/shared: el contrato Zod que consumen apps/api (validacion)
// y apps/web (tipado de payloads).
//
// El barrel es deliberadamente ANGOSTO: solo los schemas y los helpers de formato. Los
// catalogos de opciones (`lib/data/*-options`) y los tipos de caja (`lib/caja/*`) se
// importan por ruta (`@gestion/shared/lib/data/sale-options`), porque el origen define
// nombres iguales para cosas distintas — `CLOSING_PERIODICITIES` es un array de valores en
// `schemas/cash-account` y un `SelectOption[]` en `data/cash-options` — y aplanarlos en un
// solo namespace reintroduce la ambiguedad que el proyecto de origen nunca tuvo.
export * from "./lib/schemas/auth";
export * from "./lib/schemas/bank-charge";
export * from "./lib/schemas/cash-account";
export * from "./lib/schemas/cash-close";
export * from "./lib/schemas/cash-count";
export * from "./lib/schemas/cash-movement";
export * from "./lib/schemas/cash-receipt-category";
export * from "./lib/schemas/cash-transfer";
export * from "./lib/schemas/client";
export * from "./lib/schemas/nota";
export * from "./lib/schemas/payment";
export * from "./lib/schemas/payment-method";
export * from "./lib/schemas/petty-cash-vale";
export * from "./lib/schemas/purchase";
export * from "./lib/schemas/reconciliation";
export * from "./lib/schemas/sale";
export * from "./lib/schemas/serie";
export * from "./lib/schemas/voucher";

export * from "./lib/utils";
