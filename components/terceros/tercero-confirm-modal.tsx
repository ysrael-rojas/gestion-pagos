"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Button, Modal, type BootstrapTheme } from "@adminlte/react";
import { alOcultarModal, mostrarModal, ocultarModal } from "./modal-bootstrap";

const MODAL_ID = "tercero-confirm-modal";

interface TerceroConfirmModalProps {
  abierto: boolean;
  titulo: string;
  mensaje: ReactNode;
  textoConfirmar: string;
  tema: BootstrapTheme;
  onConfirmar: () => void;
  onCerrar: () => void;
}

export function TerceroConfirmModal({
  abierto,
  titulo,
  mensaje,
  textoConfirmar,
  tema,
  onConfirmar,
  onCerrar,
}: TerceroConfirmModalProps) {
  useEffect(() => {
    if (abierto) {
      mostrarModal(MODAL_ID);
    } else {
      ocultarModal(MODAL_ID);
    }
  }, [abierto]);

  useEffect(() => alOcultarModal(MODAL_ID, onCerrar), [onCerrar]);

  return (
    <Modal
      id={MODAL_ID}
      title={titulo}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onCerrar}>
            Cancelar
          </button>
          <Button theme={tema} label={textoConfirmar} onClick={onConfirmar} />
        </>
      }
    >
      {mensaje}
    </Modal>
  );
}
