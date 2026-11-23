// Esquema de entrada de la unica escritura de ajustes: `PATCH /settings`.
//
// Las tres claves son las que expone `components/cajas-bancos/general-settings-card.tsx` del
// origen, y las validaciones son las de su `handleSave()`:
//
//   pen_usd_rate                > 0 y finito  -> "El tipo de cambio debe ser mayor a 0."
//   cash_difference_tolerance   >= 0 y finito -> "La tolerancia de diferencia debe ser mayor o igual a 0."
//   default_closing_periodicity uno de los tres valores del enum `closing_periodicity`
//
// Los mensajes son textuales del origen (`general-settings-card.tsx:80` y `:85`) y se usan tanto
// para el tipo (`NaN`, `"3.7"`, `true` no son numeros) como para el rango, porque la tarjeta
// muestra ese mismo texto para los dos casos (`Number.isFinite` + comparacion).
//
// Ninguna clave es obligatoria (un PATCH parcial es valido: la UI manda las tres, un consumidor
// puede mandar una) pero el objeto no puede venir vacio. `strictObject` rechaza claves
// desconocidas: `app_setting` acepta cualquier `key` en la base, pero esta ruta solo escribe el
// contrato que la UI expone, y asi una clave mal escrita no queda guardada para siempre.
//
// No hay `owner_id` ni ningun otro campo de identidad: el dueno sale de `request.sessionUser`
// (S6), igual que en el resto del borde HTTP del vertical.
import { z } from "zod";
import { CLOSING_PERIODICITIES } from "./settings.types.ts";

/** Textual del origen para la tasa (`general-settings-card.tsx:80`). */
const RATE_ERROR = "El tipo de cambio debe ser mayor a 0.";

/** Textual del origen para la tolerancia (`general-settings-card.tsx:85`). */
const TOLERANCE_ERROR = "La tolerancia de diferencia debe ser mayor o igual a 0.";

/** Body de `PATCH /settings`. */
export const settingsPatchSchema = z
	.strictObject({
		default_closing_periodicity: z.enum(CLOSING_PERIODICITIES).optional(),
		pen_usd_rate: z.number({ error: RATE_ERROR }).gt(0, RATE_ERROR).optional(),
		cash_difference_tolerance: z
			.number({ error: TOLERANCE_ERROR })
			.gte(0, TOLERANCE_ERROR)
			.optional(),
	})
	.refine((body) => Object.keys(body).length > 0, {
		message: "No hay ningún ajuste que actualizar.",
	});

export type SettingsPatch = z.output<typeof settingsPatchSchema>;
