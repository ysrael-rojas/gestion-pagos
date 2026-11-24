"use client";

// Pantalla `/configuracion/series` (T4 del slice 2: S8 de
// `odd/tasks/port-vertical-series.md`).
//
// Port de `components/configuracion/{configuracion-view,series-view}.tsx` del origen con dos
// cambios de estructura y ninguno de comportamiento:
//
// 1. La barra de solapas desaparece: el origen tenia una sola solapa ("Series de comprobantes") y
//    hoy la seccion entera es esta pantalla (`/configuracion` redirige aca, S9). Una barra de una
//    sola entrada es ruido.
// 2. Las series se piden desde el navegador por el puente `/api/backend/series` (`listSeries` de
//    `lib/configuracion/series.ts`), no por PostgREST. El puente reenvia la cookie de sesion; esta
//    pantalla es un Client Component, igual que el listado de clientes y las tarjetas de caja.
//
// La vista es la dueña de las escrituras y de los `toast` (igual que `ClientModal` +
// `/clientes/listado`), y recarga desde el API despues de cada una: no hay actualizacion optimista,
// asi la tabla nunca muestra una fila que el servidor rechazo. Los mensajes de error de S6
// (`Ya existe una serie con ese código para ese tipo.`, `La serie no existe.`) se muestran tal
// cual: el mapa de errores vive en `apps/api/src/series/series.errors.ts`.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SerieModal } from "@/components/configuracion/serie-modal";
import { SeriesDataTable } from "@/components/configuracion/series-data-table";
import {
  SERIES_COPY,
  createSerie,
  deleteSerie,
  listSeries,
  toSeriesTableRows,
  updateSerie,
  type SerieTableRow,
} from "@/lib/configuracion/series";
import type {
  SerieFormValues,
  VoucherSeriesRow,
} from "@gestion/shared/lib/schemas/serie.ts";

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : SERIES_COPY.unexpectedError;
}

export function SeriesView() {
  const [series, setSeries] = useState<VoucherSeriesRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<VoucherSeriesRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [toDelete, setToDelete] = useState<VoucherSeriesRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await listSeries();
      setSeries(data);
      setLoadError(null);
    } catch (error) {
      setSeries([]);
      setLoadError(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      try {
        const data = await listSeries();

        if (isMounted) {
          setSeries(data);
          setLoadError(null);
        }
      } catch (error) {
        if (isMounted) {
          setSeries([]);
          setLoadError(getErrorMessage(error));
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

  const rows = useMemo(() => toSeriesTableRows(series), [series]);

  /**
   * Vuelta del modelo de tabla a la fila del API.
   *
   * La tabla trabaja con `SerieTableRow` (textos resueltos) y los modales con `VoucherSeriesRow`
   * (el contrato del API, que es lo que manda `toSerieFormValues`): el id es el mismo, asi que se
   * busca la fila original en vez de duplicar el estado.
   */
  function rowSource(row: SerieTableRow): VoucherSeriesRow | null {
    return series.find((item) => item.id === row.id) ?? null;
  }

  function openCreate() {
    setEditing(null);
    setIsModalOpen(true);
  }

  function openEdit(row: VoucherSeriesRow) {
    setEditing(row);
    setIsModalOpen(true);
  }

  async function handleSave(values: SerieFormValues) {
    setIsSaving(true);

    try {
      if (editing) {
        await updateSerie(editing.id, values);
        toast.success(SERIES_COPY.toastUpdated);
      } else {
        await createSerie(values);
        toast.success(SERIES_COPY.toastCreated);
      }

      setIsModalOpen(false);
      setEditing(null);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(serie: VoucherSeriesRow) {
    setIsDeleting(true);

    try {
      await deleteSerie(serie.id);
      toast.success(SERIES_COPY.toastDeleted);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="container mx-auto flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{SERIES_COPY.sectionTitle}</h1>
        <p className="text-sm text-muted-foreground">
          {SERIES_COPY.sectionSubtitle}
        </p>
      </div>

      <Card className="bg-muted/30 ring-0">
        <CardHeader>
          <CardTitle>{SERIES_COPY.pageTitle}</CardTitle>
          <CardDescription>{SERIES_COPY.pageSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {SERIES_COPY.defaultHint}
            </p>
            <Button onClick={openCreate}>{SERIES_COPY.addAction}</Button>
          </div>

          {loadError ? (
            <p role="alert" className="text-sm text-destructive">
              {loadError}
            </p>
          ) : null}

          <SeriesDataTable
            rows={rows}
            isLoading={isLoading}
            onEdit={(row) => {
              const source = rowSource(row);

              if (source) {
                openEdit(source);
              }
            }}
            onDelete={(row) => setToDelete(rowSource(row))}
          />
        </CardContent>
      </Card>

      <SerieModal
        open={isModalOpen}
        onOpenChange={(open) => {
          setIsModalOpen(open);

          if (!open) {
            setEditing(null);
          }
        }}
        serie={editing}
        onSave={handleSave}
        isSaving={isSaving}
      />

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {SERIES_COPY.deleteDialogTitle(toDelete?.code ?? "")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {SERIES_COPY.deleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{SERIES_COPY.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              onClick={() => {
                if (toDelete) {
                  void handleDelete(toDelete);
                }

                setToDelete(null);
              }}
            >
              {SERIES_COPY.deleteConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
