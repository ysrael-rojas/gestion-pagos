"use client";

// Banda de montos del comprobante (port de `components/comprobantes/voucher-amounts-band.tsx` del
// origen, 84 lineas). Total, monto abonado y saldo por pagar, con el saldo en ambar mientras queda
// deuda y en verde cuando esta saldado.
//
// Los tres numeros los calcula la base (`voucher_balance`): la pantalla no resta nada. El saldo
// negativo cuenta como saldado, igual que en el origen.
import { Fragment } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn, formatCurrency, type Currency } from "@gestion/shared";

interface VoucherAmountsBandProps {
  total: number;
  paidAmount: number;
  balance: number;
  currency?: Currency;
}

interface AmountItem {
  label: string;
  value: number;
  valueClassName: string;
}

export function VoucherAmountsBand({
  total,
  paidAmount,
  balance,
  currency = "PEN",
}: VoucherAmountsBandProps) {
  const isSettled = balance <= 0;

  const items: AmountItem[] = [
    {
      label: "Total",
      value: total,
      valueClassName: "text-xl text-foreground",
    },
    {
      label: "Monto abonado",
      value: paidAmount,
      valueClassName: "text-lg text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Saldo por pagar",
      value: balance,
      valueClassName: cn(
        "text-lg",
        isSettled
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-amber-600 dark:text-amber-400"
      ),
    },
  ];

  return (
    <Card size="sm" className="bg-muted/30 ring-0">
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-0">
        {items.map((item, index) => (
          <Fragment key={item.label}>
            {index > 0 ? (
              <>
                <Separator orientation="vertical" className="hidden sm:block" />
                <Separator orientation="horizontal" className="sm:hidden" />
              </>
            ) : null}
            <div className="flex flex-1 flex-col gap-1 sm:px-5 sm:first:pl-0 sm:last:pr-0">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {item.label}
              </span>
              <span
                className={cn("font-semibold tabular-nums", item.valueClassName)}
              >
                {formatCurrency(item.value, currency)}
              </span>
            </div>
          </Fragment>
        ))}
      </CardContent>
    </Card>
  );
}
