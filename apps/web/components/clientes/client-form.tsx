"use client";

// Formulario de cliente (port de `components/clientes/client-form.tsx` del origen, 265 lineas).
//
// Solo cambian los imports, y por el mismo motivo que el resto del vertical: el schema Zod y el
// catalogo de documentos viven en `@gestion/shared`, que es el contrato que valida `apps/api`.
// La validacion del formulario y la del borde son entonces literalmente la misma, asi que un
// mensaje de campo que se ve aca es el que devolveria el API con el mismo input.
//
// `@gestion/shared` importa los catalogos por ruta (`lib/data/*`) y no por barrel: el barrel es
// angosto a proposito para no mezclar nombres iguales de dominios distintos (ver
// `packages/shared/src/index.ts`).
//
// Unico ajuste de comportamiento, forzado por tipos (S6): `Client.isSupplier` dejo de ser
// opcional en el monorepo, porque los endpoints de `entidad` siempre lo devuelven. Por eso el
// reset del formulario ya no necesita el `?? false` del origen.
import { useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Client, DocumentType } from "@/components/clientes/types";
import {
  DEFAULT_DOCUMENT_TYPE,
  DOCUMENT_TYPES,
  getDocumentTypeOption,
} from "@gestion/shared/lib/data/document-types.ts";
import {
  clientSchema,
  type ClientFormInput,
  type ClientFormValues,
} from "@gestion/shared";

interface ClientFormProps {
  client?: Client | null;
  onSubmit: (values: ClientFormValues) => void;
}

export const CLIENT_FORM_ID = "client-form";

const defaultValues: ClientFormValues = {
  documentType: DEFAULT_DOCUMENT_TYPE,
  documentNumber: "",
  name: "",
  address: "",
  phone: "",
  contactName: "",
  billingEmail: "",
  managementEmail: "",
  isSupplier: false,
};

const documentTypeItems = DOCUMENT_TYPES.map((option) => ({
  value: option.value,
  label: option.label,
}));

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

function FormGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="bg-muted/30 ring-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
      </CardContent>
    </Card>
  );
}

export function ClientForm({ client, onSubmit }: ClientFormProps) {
  const form = useForm<ClientFormInput, unknown, ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues,
  });

  const documentType = useWatch({
    control: form.control,
    name: "documentType",
  });
  const documentTypeOption = getDocumentTypeOption(documentType);
  const isDocumentNumberDisabled = documentType === "SIN_DOCUMENTO";
  const documentNumberLabel =
    documentType === "SIN_DOCUMENTO"
      ? "Número de documento"
      : `Número de ${documentTypeOption.label}`;

  useEffect(() => {
    form.reset(
      client
        ? {
            documentType: client.documentType,
            documentNumber: client.documentNumber,
            name: client.name,
            address: client.address,
            phone: client.phone,
            contactName: client.contactName,
            billingEmail: client.billingEmail,
            managementEmail: client.managementEmail,
            isSupplier: client.isSupplier,
          }
        : defaultValues
    );
  }, [client, form]);

  const errors = form.formState.errors;

  return (
    <form
      id={CLIENT_FORM_ID}
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-6"
    >
      <FormGroup title="Datos del documento">
        <Controller
          control={form.control}
          name="documentType"
          render={({ field }) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="documentType">Tipo de documento</Label>
              <Select
                value={field.value}
                items={documentTypeItems}
                onValueChange={(value) => {
                  if (value === null) {
                    return;
                  }

                  const next = value as DocumentType;
                  field.onChange(next);

                  if (next === "SIN_DOCUMENTO") {
                    form.setValue("documentNumber", "");
                  }
                }}
              >
                <SelectTrigger id="documentType" className="w-full">
                  <SelectValue placeholder="Selecciona un tipo" />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.documentType?.message} />
            </div>
          )}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="documentNumber">{documentNumberLabel}</Label>
          <Input
            id="documentNumber"
            placeholder={documentTypeOption.placeholder}
            disabled={isDocumentNumberDisabled}
            aria-invalid={!!errors.documentNumber}
            {...form.register("documentNumber")}
          />
          <FieldError message={errors.documentNumber?.message} />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="name">Nombre / Empresa</Label>
          <Input
            id="name"
            placeholder="Nombre o razón social"
            aria-invalid={!!errors.name}
            {...form.register("name")}
          />
          <FieldError message={errors.name?.message} />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="address">Dirección</Label>
          <Input
            id="address"
            placeholder="Dirección"
            {...form.register("address")}
          />
        </div>
      </FormGroup>

      <FormGroup title="Datos de contacto">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Teléfono</Label>
          <Input
            id="phone"
            placeholder="Teléfono"
            {...form.register("phone")}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contactName">Contacto</Label>
          <Input
            id="contactName"
            placeholder="Nombre del contacto"
            {...form.register("contactName")}
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="billingEmail">Correo de facturación</Label>
          <Input
            id="billingEmail"
            type="email"
            placeholder="correo@empresa.com"
            aria-invalid={!!errors.billingEmail}
            {...form.register("billingEmail")}
          />
          <FieldError message={errors.billingEmail?.message} />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="managementEmail">Correo de gestión</Label>
          <Input
            id="managementEmail"
            type="email"
            placeholder="correo@empresa.com"
            aria-invalid={!!errors.managementEmail}
            {...form.register("managementEmail")}
          />
          <FieldError message={errors.managementEmail?.message} />
        </div>

        <Controller
          control={form.control}
          name="isSupplier"
          render={({ field }) => (
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox
                id="isSupplier"
                checked={field.value}
                onCheckedChange={field.onChange}
              />
              <Label htmlFor="isSupplier">Es proveedor</Label>
            </div>
          )}
        />
      </FormGroup>
    </form>
  );
}
