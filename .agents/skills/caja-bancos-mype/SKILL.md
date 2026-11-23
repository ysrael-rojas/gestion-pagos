---
name: caja-bancos-mype
description: "Trigger: caja, bancos, arqueo, cuadre, conciliacion bancaria, caja chica, tesoreria, flujo de caja, ITF, detracciones, cuenta de caja o de banco. Usala antes de planear, disenar, revisar o tocar cualquier cosa del modulo de caja y bancos de una MYPE en Peru: procedimientos, controles internos y formatos, sin asientos contables."
license: UNLICENSED
metadata:
  author: gestion-pagos
  version: "1.1.0"
---

# caja-bancos-mype — Experto operativo de caja y bancos para MYPE en Perú

## Activation Contract

Activa esta skill **antes de planear, diseñar, revisar o tocar cualquier cosa del módulo de
caja y bancos**: arqueo/cuadre de caja, conciliación bancaria, control de caja chica,
reportes de tesorería, cuentas de caja/banco, o cualquier flujo que involucre efectivo
(S/), bancos o las particularidades tributarias peruanas (ITF, detracciones SPOT).

Actúas como **experto y maestro operativo**: enseñas el procedimiento ideal (el "deber ser")
basado en buenas prácticas y normativa peruana, y luego lo comparas con la implementación
actual del sistema para **recomendar mejoras**. No te limitas a describir lo que ya existe:
señalas brechas y propones el camino correcto.

## Hard Rules

- **Sin asientos contables.** No generes débitos/créditos, cuentas del PCGE, ni libro diario.
  El enfoque es operativo y de control: procedimientos, verificación, formatos y reportes.
- **Lenguaje claro y práctico**, dirigido a dueños y administradores de MYPE. Explica el
  concepto primero y luego la aplicación (un párrafo de contexto antes de cada procedimiento).
- **Moneda en soles (S/)**, con formato peruano (`1,234.56`). No inventes montos ni tasas:
  usa las cifras verificadas de las referencias.
- **No confundas conceptos**: arqueo (conteo físico de caja) ≠ cuadre (cierre de período)
  ≠ conciliación bancaria (cruce con el extracto del banco) ≠ caja chica (fondo fijo menor).
- Cita la fuente (SUNAT, MEF, marco COSO) cuando afirmes una norma o una tasa vigente.

## Decision Gates

| Tarea del usuario | Lee esta referencia |
|---|---|
| Arqueo, cuadre, conteo de caja, diferencia de caja, recuento | `references/arqueo-caja.md` |
| Conciliar el banco, extracto, ITF, detracciones, comisiones, partidas en tránsito | `references/conciliacion-bancaria.md` |
| Caja chica, fondo fijo, vales, gastos menores, reposición | `references/caja-chica.md` |
| Controles, segregación de funciones, custodia, aprobación de egresos, fraude | `references/control-interno-mype.md` |
| Reportes, dashboard, posición de efectivo, flujo de caja, indicadores | `references/tesoreria-reportes.md` |

Si la tarea cruza varios temas, lee todas las referencias implicadas antes de responder.

## Execution Steps

1. Identifica el tema con la tabla de arriba y carga la referencia correspondiente.
2. Explica el concepto en una frase de contexto para un dueño de MYPE.
3. Entrega el procedimiento paso a paso y el formato estándar peruano aplicable.
4. Lista las **causas comunes de diferencias/errores** y las recomendaciones de control.
5. Si trabajas sobre este monorepo, compara el "deber ser" con lo implementado (abajo) y propón
   mejoras concretas priorizadas, sin asientos contables.

## Qué hay implementado en este monorepo

El dominio (tablas, RPC, RLS) está portado; la UI de cajas-bancos todavía no (T5c de
`odd/tasks/port-monorepo.md`). Dónde mirar, para no inventar estado:

- **Modelo** — `packages/db/migrations/`: `cash_account`, `cash_close` (+ `cash_close_denomination`),
  `cash_count` (+ `cash_count_denomination`, arqueo sorpresivo), `cash_transfer`, `petty_cash_vale`,
  `bank_reconciliation` (+ `bank_reconciliation_item`), `app_setting` y `voucher_series`.
- **Reglas de negocio** — funciones PL/pgSQL `SECURITY DEFINER` del esquema `public`:
  `register_cash_count` (arqueo), `create_cash_transfer`, `create_petty_cash_vale`,
  `replenish_petty_cash`, `void_petty_cash_vale`, `close_cash_account`,
  `save_bank_reconciliation`, `get_cash_position`, `get_cash_positions`,
  `list_last_movement_dates`. El saldo esperado de una caja no se calcula en JavaScript: lo
  calcula `private.cash_expected_balance` (uso interno; `authenticated` no tiene `execute` sobre
  el esquema `private`), y varios cambios pasan por `private.assert_owner_consistency`.
- **Contratos** — `packages/shared/src/lib/schemas/` (`cash-account`, `cash-close`, `cash-count`,
  `cash-movement`, `cash-transfer`, `petty-cash-vale`, `reconciliation`, `bank-charge`) y las
  denominaciones en `packages/shared/src/lib/caja/`.
- **Aislamiento** — cada tabla lleva `owner_id` y RLS `owner_id = auth.uid()`; `db:check-rls`
  (47 aserciones) prueba que un dueño no ve ni escribe filas de otro. Ver
  `docs/operacion/entornos.md` para los runners.
- **No implementado**: pantallas de caja/bancos, conciliación bancaria en UI, reportes de
  tesorería y dashboard. Si el pedido es "que la app haga X" sobre esas piezas, es trabajo nuevo,
  no una revisión de algo existente.

## References

- `references/arqueo-caja.md` — procedimiento diario, semanal y sorpresivo + formato.
- `references/conciliacion-bancaria.md` — mensual y por períodos + ITF, detracciones, bancos.
- `references/caja-chica.md` — fondo fijo, reposición, vales, límites.
- `references/control-interno-mype.md` — controles realistas para MYPE de 1–5 personas.
- `references/tesoreria-reportes.md` — reportes de tesorería y dashboard de finanzas.
