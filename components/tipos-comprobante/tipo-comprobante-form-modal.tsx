"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Modal } from "@adminlte/react";
import {
  type CampoError,
  type TipoComprobante,
} from "@/lib/tipos-comprobante/dominio";
import { actualizar, crear } from "@/lib/tipos-comprobante/repo";
import { alOcultarModal, mostrarModal, ocultarModal } from "@/components/terceros/modal-bootstrap";

const MODAL_ID = "tipo-comprobante-form-modal";
const FORM_ID = "tipo-comprobante-form";

interface TipoComprobanteFormModalProps {
  abierto: boolean;
  tipo: TipoComprobante | null;
  onGuardar: (tipo: TipoComprobante) => void;
  onCerrar: () => void;
}

export function TipoComprobanteFormModal({
  abierto,
  tipo,
  onGuardar,
  onCerrar,
}: TipoComprobanteFormModalProps) {
  const [nombre, setNombre] = useState(() => tipo?.nombre ?? "");
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

  const enviar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    setGuardando(true);
    setErrores({});

    const resultado = tipo ? actualizar(tipo.id, { nombre }) : crear({ nombre });

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
      title={tipo ? "Editar tipo" : "Nuevo tipo"}
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
          <div className="col-12">
            <Input
              name="nombre"
              label="Nombre"
              value={nombre}
              onChange={(evento) => setNombre(evento.target.value)}
              error={errores.nombre}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
