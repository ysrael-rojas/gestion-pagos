"use client";

// Tarjeta de categorias de recibo (C7 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/categorias-card.tsx` del origen (170 lineas): listado con
// busqueda, renombrado en linea, activar/desactivar y alta por modal.
//
// DESVIO DELIBERADO (el unico) respecto del origen: en vez de un filtro por estado con tres
// opciones, la tarjeta lista TODAS las categorias (activas e inactivas) y el estado se ve en la
// fila con el interruptor que ya existe. El origen tenia ademas un desplegable de filtro; aca no
// aporta, porque la lista de una MYPE entra completa en una pantalla y el interruptor ya dice el
// estado de cada fila.
//
// Para eso el API expone `GET /receipt-categories?onlyActive=false` (aditivo de C7, con default
// `true` para no cambiar el contrato del formulario de pagos). Sin ese parametro desactivar una
// categoria la sacaba del listado y VOLVER A ACTIVARLA NO SE PODIA: su `PATCH` necesita el id de
// una fila que ya no estaba en pantalla.
//
// NO HAY BORRADO, ni lo habra: una categoria la referencian los recibos
// (`payment.category_id`), asi que "borrar" es desactivar. El alta NO manda `code`: lo deriva el
// API del nombre (SPEC 37), y renombrar no lo re-deriva.
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { CategoriasDataTable } from "@/components/cajas-bancos/categorias-data-table";
import { CategoriasModal } from "@/components/cajas-bancos/categorias-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashReceiptCategory } from "@/components/pagos/types";
import { listReceiptCategories, updateReceiptCategory } from "@/lib/api/client";

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado. Intenta nuevamente.";
}

export function CategoriasCard() {
  const [categories, setCategories] = useState<CashReceiptCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const reload = useCallback(async () => {
    const data = await listReceiptCategories(undefined, false);
    setCategories(data);
  }, []);

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      setIsLoading(true);
      try {
        const data = await listReceiptCategories(undefined, false);
        if (isMounted) {
          setCategories(data);
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

  const handleRename = useCallback(
    async (category: CashReceiptCategory, name: string) => {
      if (!name.trim()) {
        toast.error("El nombre es obligatorio.");
        return;
      }

      try {
        await updateReceiptCategory(category.id, { name: name.trim() });
        await reload();
        toast.success("Categoría actualizada.");
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    },
    [reload],
  );

  const handleToggle = useCallback(
    async (category: CashReceiptCategory) => {
      try {
        await updateReceiptCategory(category.id, { isActive: !category.isActive });
        await reload();
        toast.success(
          category.isActive
            ? "Categoría desactivada: deja de ofrecerse en el formulario de pagos."
            : "Categoría activada.",
        );
      } catch (error) {
        toast.error(getErrorMessage(error));
      }
    },
    [reload],
  );

  return (
    <Card className="bg-muted/30 ring-0">
      <CardHeader>
        <CardTitle>Categorías de recibos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Una categoría desactivada deja de ofrecerse en el formulario de pagos y sigue listada
            acá para poder volver a activarla. Los recibos que ya la usan no cambian.
          </p>
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus />
            Agregar categoría
          </Button>
        </div>

        <CategoriasDataTable
          categories={categories}
          isLoading={isLoading}
          onRename={(category, name) => void handleRename(category, name)}
          onToggle={(category) => void handleToggle(category)}
        />

        <CategoriasModal open={isModalOpen} onOpenChange={setIsModalOpen} onCreated={reload} />
      </CardContent>
    </Card>
  );
}
