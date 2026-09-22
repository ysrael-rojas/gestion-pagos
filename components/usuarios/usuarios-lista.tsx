"use client";

import { useCallback, useMemo, useState } from "react";
import { Badge, Button, Card, Pagination, Table, type TableColumn } from "@adminlte/react";
import { ETIQUETAS_ROL } from "@/lib/auth/permisos";
import { cambiarActivoUsuario } from "@/lib/usuarios/acciones";
import {
  MENSAJE_DESACTIVAR_PROPIO,
  MENSAJE_ULTIMO_ADMIN,
  puedeCambiarEstado,
  type Usuario,
} from "@/lib/usuarios/dominio";
import { UsuarioConfirmModal } from "./usuario-confirm-modal";
import { UsuarioFormModal } from "./usuario-form-modal";

const POR_PAGINA = 10;

const FORMATO_FECHA = new Intl.DateTimeFormat("es", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatearUltimoAcceso(ultimoAcceso: string | null): string {
  if (ultimoAcceso === null) {
    return "—";
  }

  return FORMATO_FECHA.format(new Date(ultimoAcceso));
}

interface EstadoFormulario {
  abierto: boolean;
  usuario: Usuario | null;
  sesion: number;
}

interface EstadoConfirmacion {
  abierto: boolean;
  usuario: Usuario | null;
  activo: boolean;
}

interface UsuariosListaProps {
  iniciales: Usuario[];
  actorId: string;
}

export function UsuariosLista({ iniciales, actorId }: UsuariosListaProps) {
  const [usuarios, setUsuarios] = useState<Usuario[]>(iniciales);
  const [procesando, setProcesando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [formulario, setFormulario] = useState<EstadoFormulario>({
    abierto: false,
    usuario: null,
    sesion: 0,
  });
  const [confirmacion, setConfirmacion] = useState<EstadoConfirmacion>({
    abierto: false,
    usuario: null,
    activo: false,
  });

  const adminsActivos = useMemo(
    () => usuarios.filter((usuario) => usuario.rol === "administrador" && usuario.activo).length,
    [usuarios],
  );

  const abrirAlta = useCallback(
    () => setFormulario((previo) => ({ abierto: true, usuario: null, sesion: previo.sesion + 1 })),
    [],
  );
  const abrirEdicion = useCallback(
    (usuario: Usuario) =>
      setFormulario((previo) => ({ abierto: true, usuario, sesion: previo.sesion + 1 })),
    [],
  );
  const cerrarFormulario = useCallback(
    () => setFormulario((previo) => ({ ...previo, abierto: false })),
    [],
  );
  const alGuardar = useCallback((guardado: Usuario) => {
    setFormulario((previo) => ({ ...previo, abierto: false }));
    setErrorGeneral(null);
    setUsuarios((previo) =>
      previo.some((usuario) => usuario.id === guardado.id)
        ? previo.map((usuario) => (usuario.id === guardado.id ? guardado : usuario))
        : [...previo, guardado],
    );
  }, []);

  const abrirConfirmacion = useCallback(
    (usuario: Usuario, activo: boolean) => setConfirmacion({ abierto: true, usuario, activo }),
    [],
  );
  const cerrarConfirmacion = useCallback(
    () => setConfirmacion((previo) => ({ ...previo, abierto: false })),
    [],
  );
  const confirmar = useCallback(async () => {
    const { usuario, activo } = confirmacion;
    if (!usuario) {
      setConfirmacion((previo) => ({ ...previo, abierto: false }));
      return;
    }

    setProcesando(true);
    setErrorGeneral(null);

    const resultado = await cambiarActivoUsuario(usuario.id, activo);

    setProcesando(false);

    if (!resultado.ok) {
      setErrorGeneral(resultado.errores.general ?? "No se pudo completar la operación.");
      setConfirmacion((previo) => ({ ...previo, abierto: false }));
      return;
    }

    setUsuarios((previo) =>
      previo.map((actual) => (actual.id === resultado.valor.id ? resultado.valor : actual)),
    );
    setConfirmacion((previo) => ({ ...previo, abierto: false }));
  }, [confirmacion]);

  const totalPaginas = Math.max(1, Math.ceil(usuarios.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const visibles = usuarios.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const columnas: TableColumn<Usuario>[] = [
    {
      key: "nombre",
      header: "Nombre",
      render: (usuario) => usuario.nombre,
    },
    {
      key: "correo",
      header: "Email",
      render: (usuario) => usuario.correo,
    },
    {
      key: "rol",
      header: "Rol",
      render: (usuario) => (
        <Badge theme={usuario.rol === "administrador" ? "primary" : "info"}>
          {ETIQUETAS_ROL[usuario.rol]}
        </Badge>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (usuario) =>
        usuario.activo ? (
          <Badge theme="success">Activo</Badge>
        ) : (
          <Badge theme="secondary">Inactivo</Badge>
        ),
    },
    {
      key: "ultimoAcceso",
      header: "Último acceso",
      render: (usuario) => formatearUltimoAcceso(usuario.ultimoAcceso),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "end",
      render: (usuario) => {
        const motivoEstado =
          usuario.activo && !puedeCambiarEstado({ id: actorId }, usuario, adminsActivos)
            ? usuario.id === actorId
              ? MENSAJE_DESACTIVAR_PROPIO
              : MENSAJE_ULTIMO_ADMIN
            : null;

        return (
          <div className="d-flex justify-content-end gap-1">
            <Button
              theme="secondary"
              outline
              size="sm"
              icon="bi-pencil"
              aria-label={`Editar ${usuario.nombre}`}
              onClick={() => abrirEdicion(usuario)}
              disabled={procesando}
            />
            {usuario.activo ? (
              <Button
                theme="danger"
                outline
                size="sm"
                icon="bi-slash-circle"
                aria-label={`Desactivar ${usuario.nombre}`}
                title={motivoEstado ?? undefined}
                onClick={() => abrirConfirmacion(usuario, false)}
                disabled={procesando || motivoEstado !== null}
              />
            ) : (
              <Button
                theme="success"
                outline
                size="sm"
                icon="bi-arrow-clockwise"
                aria-label={`Reactivar ${usuario.nombre}`}
                onClick={() => abrirConfirmacion(usuario, true)}
                disabled={procesando}
              />
            )}
          </div>
        );
      },
    },
  ];

  const desactivando = !confirmacion.activo;

  return (
    <>
      <Card title="Listado de usuarios">
        {errorGeneral ? (
          <div className="alert alert-danger alert-dismissible py-2 mb-3" role="alert">
            {errorGeneral}
            <button
              type="button"
              className="btn-close"
              aria-label="Cerrar"
              onClick={() => setErrorGeneral(null)}
            />
          </div>
        ) : null}

        <div className="d-flex justify-content-end mb-3">
          <Button
            theme="primary"
            icon="bi-plus-lg"
            label="Nuevo usuario"
            onClick={abrirAlta}
            disabled={procesando}
          />
        </div>

        <Table
          columns={columnas}
          data={visibles}
          rowKey={(usuario) => usuario.id}
          hover
          responsive
          emptyMessage="No hay Usuarios."
        />

        <div className="mt-3">
          <Pagination
            page={paginaActual}
            totalPages={totalPaginas}
            onPageChange={setPagina}
            align="end"
          />
        </div>
      </Card>

      <UsuarioFormModal
        key={formulario.sesion}
        abierto={formulario.abierto}
        usuario={formulario.usuario}
        actorId={actorId}
        adminsActivos={adminsActivos}
        onGuardar={alGuardar}
        onCerrar={cerrarFormulario}
      />

      <UsuarioConfirmModal
        abierto={confirmacion.abierto}
        procesando={procesando}
        titulo={desactivando ? "Desactivar usuario" : "Reactivar usuario"}
        tema={desactivando ? "danger" : "success"}
        textoConfirmar={desactivando ? "Desactivar" : "Reactivar"}
        mensaje={
          confirmacion.usuario === null ? null : desactivando ? (
            <p className="mb-0">
              ¿Desactivar a «{confirmacion.usuario.nombre}»? No podrá iniciar sesión hasta que lo
              reactives.
            </p>
          ) : (
            <p className="mb-0">
              ¿Reactivar a «{confirmacion.usuario.nombre}»? Volverá a poder iniciar sesión.
            </p>
          )
        }
        onConfirmar={confirmar}
        onCerrar={cerrarConfirmacion}
      />
    </>
  );
}
