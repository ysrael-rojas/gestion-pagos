"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Modal, Select } from "@adminlte/react";
import { actualizar, crear } from "@/lib/comprobantes/repo";
import {
  CONDICIONES_PAGO,
  ETIQUETAS_CONDICION,
  calcularIgv,
  type CampoError,
  type ComprobanteCompra,
  type CondicionPago,
} from "@/lib/comprobantes/dominio";
import { listar as listarTipos } from "@/lib/tipos-comprobante/repo";
import type { TipoComprobante } from "@/lib/tipos-comprobante/dominio";
import { alOcultarModal, mostrarModal, ocultarModal } from "@/components/terceros/modal-bootstrap";

const MODAL_ID = "comprobante-form-modal";
const FORM_ID = "comprobante-form";

const FORMATO_MONEDA = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
});

const OPCIONES_CONDICION = CONDICIONES_PAGO.map((condicion) => ({
  value: condicion,
  label: ETIQUETAS_CONDICION[condicion],
}));

interface FormComprobante {
  fechaEmision: string;
  tipoComprobanteId: string;
  numero: string;
  proveedor: string;
  subtotal: string;
  total: string;
  condicionPago: CondicionPago;
  fechaVencimiento: string;
}

function formularioInicial(comprobante: ComprobanteCompra | null): FormComprobante {
  if (!comprobante) {
    return {
      fechaEmision: "",
      tipoComprobanteId: "",
      numero: "",
      proveedor: "",
      subtotal: "",
      total: "",
      condicionPago: "contado",
      fechaVencimiento: "",
    };
  }

  return {
    fechaEmision: comprobante.fechaEmision,
    tipoComprobanteId: comprobante.tipoComprobanteId,
    numero: comprobante.numero,
    proveedor: comprobante.proveedor,
    subtotal: String(comprobante.subtotal),
    total: String(comprobante.total),
    condicionPago: comprobante.condicionPago,
    fechaVencimiento: comprobante.fechaVencimiento ?? "",
  };
}

function aNumero(valor: string): number {
  return valor.trim() === "" ? Number.NaN : Number(valor);
}

interface ComprobanteFormModalProps {
  abierto: boolean;
  comprobante: ComprobanteCompra | null;
  onGuardar: (comprobante: ComprobanteCompra) => void;
  onCerrar: () => void;
}

export function ComprobanteFormModal({
  abierto,
  comprobante,
  onGuardar,
  onCerrar,
}: ComprobanteFormModalProps) {
  const [form, setForm] = useState<FormComprobante>(() => formularioInicial(comprobante));
  const [tipos, setTipos] = useState<TipoComprobante[]>([]);
  const [errores, setErrores] = useState<Partial<Record<CampoError, string>>>({});
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (abierto) {
      mostrarModal(MODAL_ID);
    } else {
      ocultarModal(MODAL_ID);
    }
  }, [abierto]);

  useEffect(() => alOcultarModal(MODAL_ID, onCerrar), [onCerrar]);

  useEffect(() => {
    if (!abierto) {
      return;
    }

    const id = setTimeout(() => setTipos(listarTipos()), 0);
    return () => clearTimeout(id);
  }, [abierto]);

  const opcionesTipo = useMemo(() => {
    const activos = tipos.filter((tipo) => tipo.activo);
    const actual = comprobante
      ? tipos.find((tipo) => tipo.id === comprobante.tipoComprobanteId)
      : undefined;
    const disponibles =
      actual && !actual.activo ? [...activos, actual] : activos;

    return [
      { value: "", label: "Selecciona un tipo" },
      ...disponibles.map((tipo) => ({ value: tipo.id, label: tipo.nombre })),
    ];
  }, [tipos, comprobante]);

  const subtotalNumero = aNumero(form.subtotal);
  const totalNumero = aNumero(form.total);
  const igv =
    Number.isFinite(subtotalNumero) &&
    Number.isFinite(totalNumero) &&
    totalNumero >= subtotalNumero
      ? calcularIgv(subtotalNumero, totalNumero)
      : null;

  const esCredito = form.condicionPago === "credito";

  const enviar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    setGuardando(true);
    setErrores({});

    const datos = {
      fechaEmision: form.fechaEmision,
      tipoComprobanteId: form.tipoComprobanteId,
      numero: form.numero,
      proveedor: form.proveedor,
      subtotal: subtotalNumero,
      total: totalNumero,
      condicionPago: form.condicionPago,
      fechaVencimiento: esCredito && form.fechaVencimiento !== "" ? form.fechaVencimiento : null,
    };

    const resultado = comprobante
      ? actualizar(comprobante.id, datos)
      : crear(datos);

    setGuardando(false);

    if (!resultado.ok) {
      setErrores(resultado.errores);
      return;
    }

    onGuardar(resultado.valor);
  };

  return (
    <Modal
      id={MODAL_ID}
      title={comprobante ? "Editar comprobante" : "Nuevo comprobante"}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onCerrar}>
            Cancelar
          </button>
          <Button
            theme="primary"
            type="submit"
            form={FORM_ID}
            label={guardando ? "Guardando…" : "Guardar"}
            disabled={guardando}
          />
        </>
      }
    >
      <form id={FORM_ID} onSubmit={enviar} noValidate>
        {errores.general ? (
          <div className="alert alert-danger py-2 mb-3" role="alert">
            {errores.general}
          </div>
        ) : null}

        <div className="row">
          <div className="col-12 col-md-6">
            <Input
              name="fechaEmision"
              label="Fecha de emisión"
              type="date"
              value={form.fechaEmision}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, fechaEmision: evento.target.value }))
              }
              error={errores.fechaEmision}
            />
          </div>
          <div className="col-12 col-md-6">
            <Select
              name="tipoComprobanteId"
              label="Tipo de comprobante"
              value={form.tipoComprobanteId}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, tipoComprobanteId: evento.target.value }))
              }
              options={opcionesTipo}
              error={errores.tipoComprobanteId}
            />
          </div>
          <div className="col-12 col-md-6">
            <Input
              name="numero"
              label="Nro de documento"
              value={form.numero}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, numero: evento.target.value }))
              }
              error={errores.numero}
            />
          </div>
          <div className="col-12 col-md-6">
            <Input
              name="proveedor"
              label="Proveedor"
              value={form.proveedor}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, proveedor: evento.target.value }))
              }
              error={errores.proveedor}
            />
          </div>
          <div className="col-12 col-md-4">
            <Input
              name="subtotal"
              label="Subtotal"
              type="number"
              min="0"
              step="0.01"
              value={form.subtotal}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, subtotal: evento.target.value }))
              }
              error={errores.subtotal}
            />
          </div>
          <div className="col-12 col-md-4">
            <Input
              name="igv"
              label="IGV"
              value={igv === null ? "" : FORMATO_MONEDA.format(igv)}
              readOnly
              disabled
            />
          </div>
          <div className="col-12 col-md-4">
            <Input
              name="total"
              label="Total"
              type="number"
              min="0"
              step="0.01"
              value={form.total}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, total: evento.target.value }))
              }
              error={errores.total}
            />
          </div>
          <div className="col-12 col-md-6">
            <Select
              name="condicionPago"
              label="Condición de pago"
              value={form.condicionPago}
              onChange={(evento) =>
                setForm((previo) => ({
                  ...previo,
                  condicionPago: evento.target.value as CondicionPago,
                  fechaVencimiento:
                    evento.target.value === "contado" ? "" : previo.fechaVencimiento,
                }))
              }
              options={OPCIONES_CONDICION}
              error={errores.condicionPago}
            />
          </div>
          {esCredito ? (
            <div className="col-12 col-md-6">
              <Input
                name="fechaVencimiento"
                label="Fecha de vencimiento"
                type="date"
                value={form.fechaVencimiento}
                onChange={(evento) =>
                  setForm((previo) => ({ ...previo, fechaVencimiento: evento.target.value }))
                }
                error={errores.fechaVencimiento}
              />
            </div>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
