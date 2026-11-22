"use client";

// Listado de clientes (port de `app/(app)/clientes/listado/page.tsx` del origen, 160 lineas).
//
// Es la unica vista del vertical y por eso concentra el estado de los tres modales (alta/edicion,
// detalle y confirmacion de baja), igual que en el origen. Todo lo que toca datos pasa por
// `useClientes()`: el provider espera la escritura del API y despues refresca, sin actualizacion
// optimista, asi que la tabla nunca muestra una fila que el servidor rechazo.
//
// Diferencias con el origen, todas por el stack:
//
// - Las mutaciones ya no hablan con Supabase: `addClient`/`updateClient`/`removeClient` pegan
//   contra los endpoints `entities` de `apps/api`. Los mensajes de error no se traducen aca: el
//   API responde 409 con "Ya existe un cliente con ese tipo y numero de documento." y 400 con el
//   mensaje del schema compartido, y `ApiError` los entrega tal cual. Por eso el texto del
//   conflicto NO aparece en este archivo: esta en `entities.errors.ts`.
// - La confirmacion de baja usa el texto fijado por el feature doc (S3), no el del origen.
// - Ya esta `"use client"`, como en el origen: aca no hay `searchParams` que resolver en el
//   servidor, todo el estado es local y las escrituras salen del navegador por el puente
//   `/api/backend`.
//
// `error` del provider (el del listado) no se renderiza porque el origen tampoco lo renderizaba: la
// pantalla muestra los errores de las acciones en un toast y deja el listado vacio si la lectura
// falla. La vista de pagos hace lo mismo (`payments-view.tsx`).
import { useState } from "react";
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
import { useClientes } from "@/components/clientes/clientes-provider";
import { ClientDetailModal } from "@/components/clientes/client-detail-modal";
import { ClientModal } from "@/components/clientes/client-modal";
import { ClientsDataTable } from "@/components/clientes/clients-data-table";
import type { Client } from "@/components/clientes/types";
import type { ClientFormValues } from "@gestion/shared";

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado. Intenta nuevamente.";
}

export default function ClientesListadoPage() {
  const { clients, isLoading, addClient, updateClient, removeClient } =
    useClientes();
  const [modalOpen, setModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [viewingClient, setViewingClient] = useState<Client | null>(null);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);

  function openCreate() {
    setEditingClient(null);
    setModalOpen(true);
  }

  function openEdit(client: Client) {
    setEditingClient(client);
    setModalOpen(true);
  }

  function openView(client: Client) {
    setViewingClient(client);
  }

  async function handleSave(values: ClientFormValues) {
    setIsSaving(true);

    try {
      if (editingClient) {
        await updateClient(editingClient.id, values);
        toast.success("Cliente actualizado");
      } else {
        await addClient(values);
        toast.success("Cliente registrado");
      }

      setModalOpen(false);
      setEditingClient(null);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(client: Client) {
    try {
      await removeClient(client.id);
      toast.success("Cliente eliminado");
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <main className="container mx-auto flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Registra y administra tus clientes
          </p>
        </div>
        <Button onClick={openCreate}>Registrar cliente</Button>
      </div>

      <ClientsDataTable
        clients={clients}
        isLoading={isLoading}
        onView={openView}
        onEdit={openEdit}
        onDelete={(client) => setClientToDelete(client)}
      />

      <ClientModal
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setEditingClient(null);
          }
        }}
        client={editingClient}
        onSave={handleSave}
        isSaving={isSaving}
      />

      <ClientDetailModal
        open={viewingClient !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewingClient(null);
          }
        }}
        client={viewingClient}
      />

      <AlertDialog
        open={clientToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setClientToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar cliente</AlertDialogTitle>
            <AlertDialogDescription>
              ¿Seguro que quieres eliminar este cliente? Esta acción no se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (clientToDelete) {
                  void handleDelete(clientToDelete);
                }
                setClientToDelete(null);
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
