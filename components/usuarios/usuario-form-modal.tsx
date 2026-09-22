"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Input, Modal, Select } from "@adminlte/react";
import { ETIQUETAS_ROL, ROLES_USUARIO, type RolUsuario } from "@/lib/auth/permisos";
import { actualizarUsuario, crearUsuario } from "@/lib/usuarios/acciones";
import {
  MENSAJE_ROL_PROPIO,
  MENSAJE_ULTIMO_ADMIN,
  esUltimoAdminActivo,
  puedeCambiarRol,
  type CampoError,
  type Usuario,
} from "@/lib/usuarios/dominio";
import { alOcultarModal, mostrarModal, ocultarModal } from "@/components/terceros/modal-bootstrap";

const MODAL_ID = "usuario-form-modal";
const FORM_ID = "usuario-form";

const OPCIONES_ROL = ROLES_USUARIO.map((rol) => ({
  value: rol,
  label: ETIQUETAS_ROL[rol],
}));

interface FormUsuario {
  correo: string;
  nombre: string;
  rol: RolUsuario;
  contrasena: string;
}

function formularioInicial(usuario: Usuario | null): FormUsuario {
  if (!usuario) {
    return { correo: "", nombre: "", rol: "operador", contrasena: "" };
  }

  return { correo: usuario.correo, nombre: usuario.nombre, rol: usuario.rol, contrasena: "" };
}

interface UsuarioFormModalProps {
  abierto: boolean;
  usuario: Usuario | null;
  actorId: string;
  adminsActivos: number;
  onGuardar: (usuario: Usuario) => void;
  onCerrar: () => void;
}

export function UsuarioFormModal({
  abierto,
  usuario,
  actorId,
  adminsActivos,
  onGuardar,
  onCerrar,
}: UsuarioFormModalProps) {
  const [form, setForm] = useState<FormUsuario>(() => formularioInicial(usuario));
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

  const motivoRolBloqueado = usuario
    ? !puedeCambiarRol({ id: actorId }, usuario)
      ? MENSAJE_ROL_PROPIO
      : esUltimoAdminActivo(usuario, adminsActivos)
        ? MENSAJE_ULTIMO_ADMIN
        : null
    : null;

  const enviar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    setGuardando(true);
    setErrores({});

    const resultado = usuario
      ? await actualizarUsuario(usuario.id, { nombre: form.nombre, rol: form.rol })
      : await crearUsuario({
          correo: form.correo,
          nombre: form.nombre,
          rol: form.rol,
          contrasena: form.contrasena,
        });

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
      title={usuario ? "Editar usuario" : "Nuevo usuario"}
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
          {usuario ? null : (
            <div className="col-12">
              <Input
                name="correo"
                label="Email"
                type="email"
                value={form.correo}
                onChange={(evento) =>
                  setForm((previo) => ({ ...previo, correo: evento.target.value }))
                }
                error={errores.correo}
              />
            </div>
          )}
          <div className="col-12">
            <Input
              name="nombre"
              label="Nombre"
              value={form.nombre}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, nombre: evento.target.value }))
              }
              error={errores.nombre}
            />
          </div>
          <div className="col-12 col-md-6">
            <Select
              name="rol"
              label="Rol"
              value={form.rol}
              onChange={(evento) =>
                setForm((previo) => ({ ...previo, rol: evento.target.value as RolUsuario }))
              }
              options={OPCIONES_ROL}
              error={errores.rol}
              disabled={motivoRolBloqueado !== null}
              title={motivoRolBloqueado ?? undefined}
            />
            {motivoRolBloqueado ? (
              <div className="form-text">{motivoRolBloqueado}</div>
            ) : null}
          </div>
          {usuario ? null : (
            <div className="col-12 col-md-6">
              <Input
                name="contrasena"
                label="Contraseña temporal"
                type="password"
                value={form.contrasena}
                onChange={(evento) =>
                  setForm((previo) => ({ ...previo, contrasena: evento.target.value }))
                }
                error={errores.contrasena}
              />
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
