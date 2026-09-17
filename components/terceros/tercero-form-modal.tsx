"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Modal, Select } from "@adminlte/react";
import {
  ETIQUETAS_ROL,
  ETIQUETAS_TIPO_DOCUMENTO,
  ROLES,
  TIPOS_DOCUMENTO,
  actualizar,
  crear,
  etiquetaNombre,
  type CampoError,
  type RolTercero,
  type Tercero,
  type TipoDocumento,
} from "@/lib/terceros-repo";
import { alOcultarModal, mostrarModal, ocultarModal } from "./modal-bootstrap";

const MODAL_ID = "tercero-form-modal";
const FORM_ID = "tercero-form";

const OPCIONES_TIPO_DOCUMENTO = TIPOS_DOCUMENTO.map((tipo) => ({
  value: tipo,
  label: ETIQUETAS_TIPO_DOCUMENTO[tipo],
}));

interface FormTercero {
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
  nombre: string;
  domicilioFiscal: string;
  telefono: string;
  correo: string;
  roles: RolTercero[];
  activo: boolean;
}

function formularioInicial(tercero: Tercero | null): FormTercero {
  if (!tercero) {
    return {
      tipoDocumento: "DNI",
      numeroDocumento: "",
      nombre: "",
      domicilioFiscal: "",
      telefono: "",
      correo: "",
      roles: [],
      activo: true,
    };
  }
  return {
    tipoDocumento: tercero.tipoDocumento,
    numeroDocumento: tercero.numeroDocumento ?? "",
    nombre: tercero.nombre,
    domicilioFiscal: tercero.domicilioFiscal,
    telefono: tercero.telefono,
    correo: tercero.correo,
    roles: [...tercero.roles],
    activo: tercero.activo,
  };
}

interface TerceroFormModalProps {
  abierto: boolean;
  tercero: Tercero | null;
  onGuardar: (tercero: Tercero) => void;
  onCerrar: () => void;
}

export function TerceroFormModal({
  abierto,
  tercero,
  onGuardar,
  onCerrar,
}: TerceroFormModalProps) {
  const [form, setForm] = useState<FormTercero>(() => formularioInicial(tercero));
  const [errores, setErrores] = useState<Partial<Record<CampoError, string>>>({});

  useEffect(() => {
    if (abierto) {
      mostrarModal(MODAL_ID);
    } else {
      ocultarModal(MODAL_ID);
    }
  }, [abierto]);

  useEffect(() => alOcultarModal(MODAL_ID, onCerrar), [onCerrar]);

  const sinDocumento = form.tipoDocumento === "SIN_DOCUMENTO";

  const enviar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const resultado = tercero ? actualizar(tercero.id, form) : crear(form);
    if (!resultado.ok) {
      setErrores(resultado.errores);
      return;
    }
    onGuardar(resultado.valor);
  };

  return (
    <Modal
      id={MODAL_ID}
      title={tercero ? "Editar Tercero" : "Nuevo Tercero"}
      footer={
        <>
          <button type="button" className="btn btn-outline-secondary" onClick={onCerrar}>
            Cancelar
          </button>
          <Button theme="primary" type="submit" form={FORM_ID} label="Guardar" />
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
            <Select
              name="tipoDocumento"
              label="Tipo de documento"
              value={form.tipoDocumento}
              onChange={(evento) =>
                setForm((previo) => ({
                  ...previo,
                  tipoDocumento: evento.target.value as TipoDocumento,
                  numeroDocumento:
                    evento.target.value === "SIN_DOCUMENTO" ? "" : previo.numeroDocumento,
                }))
              }
              options={OPCIONES_TIPO_DOCUMENTO}
              error={errores.tipoDocumento}
            />
          </div>
          <div className="col-12 col-md-6">
            <Input
              name="numeroDocumento"
              label="Número de documento"
              value={sinDocumento ? "" : form.numeroDocumento}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, numeroDocumento: evento.target.value }))
              }
              disabled={sinDocumento}
              error={errores.numeroDocumento}
              hint={sinDocumento ? "No se registra número para este tipo." : undefined}
            />
          </div>
          <div className="col-12">
            <Input
              name="nombre"
              label={etiquetaNombre(form.tipoDocumento)}
              value={form.nombre}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, nombre: evento.target.value }))
              }
              error={errores.nombre}
            />
          </div>
          <div className="col-12">
            <Input
              name="domicilioFiscal"
              label="Domicilio fiscal"
              value={form.domicilioFiscal}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, domicilioFiscal: evento.target.value }))
              }
            />
          </div>
          <div className="col-12 col-md-6">
            <Input
              name="telefono"
              label="Teléfono"
              value={form.telefono}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, telefono: evento.target.value }))
              }
            />
          </div>
          <div className="col-12 col-md-6">
            <Input
              name="correo"
              label="Correo"
              type="email"
              value={form.correo}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, correo: evento.target.value }))
              }
              error={errores.correo}
            />
          </div>
          <div className="col-12">
            <span className="form-label d-block">Roles</span>
            <div className="d-flex flex-wrap gap-3">
              {ROLES.map((rol) => (
                <div className="form-check" key={rol}>
                  <input
                    className={`form-check-input ${errores.roles ? "is-invalid" : ""}`.trim()}
                    type="checkbox"
                    id={`tercero-rol-${rol}`}
                    checked={form.roles.includes(rol)}
                    onChange={() =>
                      setForm((previo) => ({
                        ...previo,
                        roles: previo.roles.includes(rol)
                          ? previo.roles.filter((actual) => actual !== rol)
                          : [...previo.roles, rol],
                      }))
                    }
                  />
                  <label className="form-check-label" htmlFor={`tercero-rol-${rol}`}>
                    {ETIQUETAS_ROL[rol]}
                  </label>
                </div>
              ))}
            </div>
            {errores.roles ? (
              <div className="invalid-feedback d-block">{errores.roles}</div>
            ) : null}
          </div>
        </div>
      </form>
    </Modal>
  );
}
