"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Button, Modal, type BootstrapTheme } from "@adminlte/react";
import { alOcultarModal, mostrarModal, ocultarModal } from "@/components/terceros/modal-bootstrap";

const MODAL_ID = "usuario-confirm-modal";

interface UsuarioConfirmModalProps {
  abierto: boolean;
  titulo: string;
  mensaje: ReactNode;
  textoConfirmar: string;
  tema: BootstrapTheme;
  procesando?: boolean;
  onConfirmar: () => void;
  onCerrar: () => void;
}

export function UsuarioConfirmModal({
  abierto,
  titulo,
  mensaje,
  textoConfirmar,
  tema,
  procesando = false,
  onConfirmar,
  onCerrar,
}: UsuarioConfirmModalProps) {
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
          <Button
            theme={tema}
            label={procesando ? "Procesando…" : textoConfirmar}
            onClick={onConfirmar}
            disabled={procesando}
          />
        </>
      }
    >
      {mensaje}
    </Modal>
  );
}
