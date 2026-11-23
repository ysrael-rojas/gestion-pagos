"use client";

// Configuracion general de caja y bancos (C7 del vertical de cajas-bancos, SPEC 52).
//
// Port de `components/cajas-bancos/general-settings-card.tsx` del origen (189 lineas): los tres
// ajustes que el vertical escribe y lee (`default_closing_periodicity`, `pen_usd_rate`,
// `cash_difference_tolerance`), con su validacion de pantalla y su guardado.
//
// DESVIO DELIBERADO (deuda L67, S7): en el origen la carga empezaba con `ensureDefaultSettings()`,
// es decir un GET que ESCRIBIA tres filas dentro de un `useEffect`. Un GET que muta no es
// comportamiento a preservar. Aca:
//
//   1. se LEE `GET /settings` (lectura pura, no siembra nada);
//   2. si `needsDefaultSettings` dice que falta alguna de las tres claves, se llama UNA vez a
//      `POST /settings/ensure` (idempotente) y se vuelve a leer;
//   3. el guardado es UN `PATCH /settings` con las tres claves, no tres `setAppSetting` seguidos
//      como el origen: el API las normaliza el solo (`String(rate)` y `tolerance.toFixed(2)`), asi
//      que el valor guardado no depende del cliente y no queda un estado intermedio si una de las
//      tres escrituras fallara.
//
// Los lectores con fallback de las tres claves viven en `lib/cajas-bancos/settings.ts`, que es
// donde estan sus defaults y sus tests de comportamiento (no en este componente).
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ensureSettings, getSettings, updateSettings } from "@/lib/api/client";
import { closingPeriodicityFrom, needsDefaultSettings } from "@/lib/cajas-bancos/settings";
import type { ClosingPeriodicity } from "@/lib/api/client";
import { CLOSING_PERIODICITIES } from "@gestion/shared/lib/data/cash-options.ts";

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado. Intenta nuevamente.";
}

export function GeneralSettingsCard() {
  const [periodicity, setPeriodicity] = useState<ClosingPeriodicity>("DAILY");
  const [rate, setRate] = useState("3.75");
  const [tolerance, setTolerance] = useState("0.50");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      try {
        let settings = await getSettings();

        // Siembra explicita y solo si falta alguna clave (S7): un render no escribe.
        if (needsDefaultSettings(settings)) {
          await ensureSettings();
          settings = await getSettings();
        }

        if (isMounted) {
          setPeriodicity(closingPeriodicityFrom(settings));
          setRate(settings.pen_usd_rate ?? "3.75");
          setTolerance(settings.cash_difference_tolerance ?? "0.50");
        }
      } catch (error) {
        if (isMounted) {
          toast.error(getErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSave() {
    const numericRate = Number(rate);
    const numericTolerance = Number(tolerance);

    if (!Number.isFinite(numericRate) || numericRate <= 0) {
      toast.error("El tipo de cambio debe ser mayor a 0.");
      return;
    }

    if (!Number.isFinite(numericTolerance) || numericTolerance < 0) {
      toast.error("La tolerancia de diferencia debe ser mayor o igual a 0.");
      return;
    }

    setIsSaving(true);
    try {
      await updateSettings({
        default_closing_periodicity: periodicity,
        pen_usd_rate: numericRate,
        cash_difference_tolerance: numericTolerance,
      });
      toast.success("Configuración guardada");
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="bg-muted/30 ring-0">
      <CardHeader>
        <CardTitle>Configuración general</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="defaultPeriodicity">Periodicidad de cierre predeterminada</Label>
          <Select
            value={periodicity}
            items={CLOSING_PERIODICITIES}
            onValueChange={(value) => {
              if (value === "DAILY" || value === "WEEKLY" || value === "MONTHLY") {
                setPeriodicity(value);
              }
            }}
          >
            <SelectTrigger
              id="defaultPeriodicity"
              className="w-full sm:w-64"
              disabled={isLoading}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLOSING_PERIODICITIES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Se usa en las cuentas que no tengan su propia periodicidad.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="penUsdRate">Tipo de cambio PEN/USD</Label>
          <Input
            id="penUsdRate"
            type="number"
            step="0.0001"
            min="0"
            className="w-full sm:w-64"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            disabled={isLoading}
          />
          <p className="text-xs text-muted-foreground">
            Se usa para consolidar a soles las cuentas en otra moneda.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cashDifferenceTolerance">Tolerancia de diferencia al cerrar (S/)</Label>
          <Input
            id="cashDifferenceTolerance"
            type="number"
            step="0.01"
            min="0"
            className="w-full sm:w-64"
            value={tolerance}
            onChange={(event) => setTolerance(event.target.value)}
            disabled={isLoading}
          />
          <p className="text-xs text-muted-foreground">
            Diferencias de redondeo dentro de este margen no exigen motivo; por encima, el cierre
            pide una explicación escrita.
          </p>
        </div>

        <div>
          <Button onClick={() => void handleSave()} disabled={isSaving || isLoading}>
            Guardar configuración
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
