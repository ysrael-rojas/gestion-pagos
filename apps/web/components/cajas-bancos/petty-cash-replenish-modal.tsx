"use client";

// Modal de reposicion del fondo de caja chica (C6 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/petty-cash-replenish-modal.tsx` del origen (191 lineas). El
// comportamiento es el del origen: elegir la cuenta que financia, marcar los vales pendientes a
// reponer (todos vienen marcados, que es el caso habitual) y ver el total a reponer.
//
// EL TOTAL ES UNA SUMA DE PRESENTACION, no un saldo: suma los importes de los vales que el usuario
// acaba de marcar en la lista que ya tiene en pantalla, exactamente como el origen, para que el
// usuario sepa cuanto va a salir de la cuenta origen. El monto que se transfiere lo calcula
// `replenish_petty_cash` en SQL sobre los vales que recibe; si la lista de la UI estuviera
// desactualizada, manda la base.
//
// El schema compartido aplica las reglas de campo (los tres uuid y "al menos un vale"); la de
// "el origen no puede ser la caja chica" la aplica el SQL (el body del API la excluye a proposito,
// ver `apps/api/src/cash/petty-cash.query.ts`), pero el modal la conserva como aviso temprano.
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatCurrency,
  formatDate,
  pettyCashReplenishSchema,
  round2,
  type PettyCashReplenishFormValues,
} from "@gestion/shared";
import type { PettyCashVale } from "@/lib/cajas-bancos/caja-chica";
import type { CashAccount } from "@/lib/cuentas/entidades";

interface PettyCashReplenishModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: CashAccount;
  /** Cuentas candidatas a financiar la reposición (todas menos la caja chica). */
  accounts: CashAccount[];
  pendingVales: PettyCashVale[];
  onDone: (values: PettyCashReplenishFormValues) => void;
  isSaving?: boolean;
}

export function PettyCashReplenishModal({
  open,
  onOpenChange,
  account,
  accounts,
  pendingVales,
  onDone,
  isSaving = false,
}: PettyCashReplenishModalProps) {
  const sourceAccounts = useMemo(
    () => accounts.filter((item) => item.id !== account.id),
    [accounts, account.id],
  );

  // Con una sola cuenta candidata no hay nada que elegir: se preselecciona.
  const defaultSourceAccountId =
    sourceAccounts.length === 1 ? sourceAccounts[0]!.id : "";

  const [sourceAccountId, setSourceAccountId] = useState(defaultSourceAccountId);
  // Al abrir se propone reponer todo lo pendiente: es el caso habitual.
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    pendingVales.map((vale) => vale.id),
  );
  const [error, setError] = useState<string | null>(null);

  const [wasOpen, setWasOpen] = useState(open);

  // Al reabrir se reinicia la seleccion. Patron de React para reaccionar a un cambio de prop sin
  // effect.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSourceAccountId(defaultSourceAccountId);
      setSelectedIds(pendingVales.map((vale) => vale.id));
      setError(null);
    }
  }

  const selectedTotal = round2(
    pendingVales
      .filter((vale) => selectedIds.includes(vale.id))
      .reduce((total, vale) => total + vale.amount, 0),
  );

  function toggleVale(valeId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...current, valeId] : current.filter((id) => id !== valeId),
    );
  }

  function handleSubmit() {
    const result = pettyCashReplenishSchema.safeParse({
      accountId: account.id,
      sourceAccountId,
      valeIds: selectedIds,
    });

    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Revisa los datos.");
      return;
    }

    setError(null);
    onDone(result.data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-1">
            <DialogTitle>Reponer fondo de caja chica</DialogTitle>
            <DialogDescription>
              Se transfiere el total de los vales elegidos y quedan marcados
              como repuestos.
            </DialogDescription>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sourceAccountId">Cuenta de origen</Label>
            <Select
              value={sourceAccountId || null}
              items={sourceAccounts.map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.currency}`,
              }))}
              onValueChange={(value) => setSourceAccountId(value ?? "")}
            >
              <SelectTrigger id="sourceAccountId" className="w-full">
                <SelectValue placeholder="Selecciona el origen" />
              </SelectTrigger>
              <SelectContent>
                {sourceAccounts.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} · {item.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Vales pendientes</Label>
            <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-md border p-3">
              {pendingVales.map((vale) => (
                <div key={vale.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`replenish-${vale.id}`}
                    checked={selectedIds.includes(vale.id)}
                    onCheckedChange={(checked) =>
                      toggleVale(vale.id, checked === true)
                    }
                  />
                  <Label
                    htmlFor={`replenish-${vale.id}`}
                    className="flex-1 font-normal"
                  >
                    N.º {vale.serial} · {formatDate(vale.valeDate)} ·{" "}
                    {vale.paidTo} — {vale.concept} ({formatCurrency(vale.amount)})
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/30 p-3 text-sm">
            <span className="font-medium">Total a reponer</span>
            <span className="font-semibold">{formatCurrency(selectedTotal)}</span>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button type="button" onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? "Reponiendo…" : "Reponer fondo"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
