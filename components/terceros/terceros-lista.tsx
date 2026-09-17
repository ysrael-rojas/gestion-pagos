"use client";

import { useCallback, useMemo, useState } from "react";
import { Badge, Button, Card, Pagination, Table, type TableColumn } from "@adminlte/react";
import { desactivarTercero, reactivarTercero } from "@/lib/terceros/acciones";
import {
  ETIQUETAS_ROL,
  ETIQUETAS_TIPO_DOCUMENTO,
  type FiltrosTerceros,
  type RolTercero,
  type Tercero,
} from "@/lib/terceros/dominio";
import { TerceroConfirmModal } from "./tercero-confirm-modal";
import { TerceroFormModal } from "./tercero-form-modal";

const POR_PAGINA = 5;

const TEMA_ROL: Record<RolTercero, "primary" | "info"> = {
  cliente: "primary",
  proveedor: "info",
};

function filtrar(terceros: Tercero[], filtros: FiltrosTerceros): Tercero[] {
  const { texto, rol, incluirInactivos = false } = filtros;
  const busqueda = texto?.trim().toLowerCase() ?? "";
  return terceros
    .filter((tercero) => incluirInactivos || tercero.activo)
    .filter((tercero) => (rol ? tercero.roles.includes(rol) : true))
    .filter((tercero) => {
      if (busqueda === "") {
        return true;
      }
      const nombre = tercero.nombre.toLowerCase();
      const numero = (tercero.numeroDocumento ?? "").toLowerCase();
      return nombre.includes(busqueda) || numero.includes(busqueda);
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}

interface EstadoFormulario {
  abierto: boolean;
  tercero: Tercero | null;
  sesion: number;
}

interface EstadoConfirmacion {
  abierto: boolean;
  tercero: Tercero | null;
  accion: "desactivar" | "reactivar";
}

interface TercerosListaProps {
  iniciales: Tercero[];
}

export function TercerosLista({ iniciales }: TercerosListaProps) {
  const [terceros, setTerceros] = useState<Tercero[]>(iniciales);
  const [procesando, setProcesando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [rol, setRol] = useState<RolTercero | "">("");
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [formulario, setFormulario] = useState<EstadoFormulario>({
    abierto: false,
    tercero: null,
    sesion: 0,
  });
  const [confirmacion, setConfirmacion] = useState<EstadoConfirmacion>({
    abierto: false,
    tercero: null,
    accion: "desactivar",
  });

  const filtrados = useMemo(
    () => filtrar(terceros, { texto, rol: rol === "" ? undefined : rol, incluirInactivos }),
    [terceros, texto, rol, incluirInactivos],
  );

  const abrirAlta = useCallback(
    () => setFormulario((previo) => ({ abierto: true, tercero: null, sesion: previo.sesion + 1 })),
    [],
  );
  const abrirEdicion = useCallback(
    (tercero: Tercero) =>
      setFormulario((previo) => ({ abierto: true, tercero, sesion: previo.sesion + 1 })),
    [],
  );
  const cerrarFormulario = useCallback(
    () => setFormulario((previo) => ({ ...previo, abierto: false })),
    [],
  );
  const alGuardar = useCallback((guardado: Tercero) => {
    setFormulario((previo) => ({ ...previo, abierto: false }));
    setErrorGeneral(null);
    setTerceros((previo) =>
      previo.some((tercero) => tercero.id === guardado.id)
        ? previo.map((tercero) => (tercero.id === guardado.id ? guardado : tercero))
        : [...previo, guardado],
    );
  }, []);

  const abrirConfirmacion = useCallback(
    (tercero: Tercero, accion: "desactivar" | "reactivar") =>
      setConfirmacion({ abierto: true, tercero, accion }),
    [],
  );
  const cerrarConfirmacion = useCallback(
    () => setConfirmacion((previo) => ({ ...previo, abierto: false })),
    [],
  );
  const confirmar = useCallback(async () => {
    const { tercero, accion } = confirmacion;
    if (!tercero) {
      setConfirmacion((previo) => ({ ...previo, abierto: false }));
      return;
    }

    setProcesando(true);
    setErrorGeneral(null);

    const resultado =
      accion === "desactivar"
        ? await desactivarTercero(tercero.id)
        : await reactivarTercero(tercero.id);

    setProcesando(false);

    if (!resultado.ok) {
      setErrorGeneral(resultado.errores.general ?? "No se pudo completar la operación.");
      setConfirmacion((previo) => ({ ...previo, abierto: false }));
      return;
    }

    setTerceros((previo) =>
      previo.map((actual) => (actual.id === resultado.valor.id ? resultado.valor : actual)),
    );
    setConfirmacion((previo) => ({ ...previo, abierto: false }));
  }, [confirmacion]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const visibles = filtrados.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const columnas: TableColumn<Tercero>[] = [
    {
      key: "documento",
      header: "Documento",
      render: (tercero) => (
        <div>
          <div>{ETIQUETAS_TIPO_DOCUMENTO[tercero.tipoDocumento]}</div>
          <small className="text-muted">{tercero.numeroDocumento ?? "—"}</small>
        </div>
      ),
    },
    {
      key: "nombre",
      header: "Nombre / Razón social",
      render: (tercero) => tercero.nombre,
    },
    {
      key: "roles",
      header: "Roles",
      render: (tercero) => (
        <div className="d-flex flex-wrap gap-1">
          {tercero.roles.map((valor) => (
            <Badge key={valor} theme={TEMA_ROL[valor]}>
              {ETIQUETAS_ROL[valor]}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "contacto",
      header: "Contacto",
      render: (tercero) =>
        tercero.correo === "" && tercero.telefono === "" ? (
          <span className="text-muted">—</span>
        ) : (
          <div>
            {tercero.correo ? <div>{tercero.correo}</div> : null}
            {tercero.telefono ? <small className="text-muted">{tercero.telefono}</small> : null}
          </div>
        ),
    },
    {
      key: "estado",
      header: "Estado",
      render: (tercero) =>
        tercero.activo ? (
          <Badge theme="success">Activo</Badge>
        ) : (
          <Badge theme="secondary">Inactivo</Badge>
        ),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "end",
      render: (tercero) => (
        <div className="d-flex justify-content-end gap-1">
          <Button
            theme="secondary"
            outline
            size="sm"
            icon="bi-pencil"
            aria-label={`Editar ${tercero.nombre}`}
            onClick={() => abrirEdicion(tercero)}
            disabled={procesando}
          />
          {tercero.activo ? (
            <Button
              theme="danger"
              outline
              size="sm"
              icon="bi-slash-circle"
              aria-label={`Desactivar ${tercero.nombre}`}
              onClick={() => abrirConfirmacion(tercero, "desactivar")}
              disabled={procesando}
            />
          ) : (
            <Button
              theme="success"
              outline
              size="sm"
              icon="bi-arrow-clockwise"
              aria-label={`Reactivar ${tercero.nombre}`}
              onClick={() => abrirConfirmacion(tercero, "reactivar")}
              disabled={procesando}
            />
          )}
        </div>
      ),
    },
  ];

  const desactivando = confirmacion.accion === "desactivar";

  return (
    <>
      <Card title="Listado de Terceros">
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

        <div className="row g-2 align-items-center mb-3">
          <div className="col-12 col-lg-4">
            <input
              type="search"
              className="form-control"
              placeholder="Buscar por nombre o número de documento"
              aria-label="Buscar Terceros"
              value={texto}
              onChange={(evento) => {
                setTexto(evento.target.value);
                setPagina(1);
              }}
            />
          </div>
          <div className="col-12 col-sm-6 col-lg-3">
            <select
              className="form-select"
              aria-label="Filtrar por rol"
              value={rol}
              onChange={(evento) => {
                setRol(evento.target.value as RolTercero | "");
                setPagina(1);
              }}
            >
              <option value="">Todos los roles</option>
              <option value="cliente">Clientes</option>
              <option value="proveedor">Proveedores</option>
            </select>
          </div>
          <div className="col-12 col-sm-6 col-lg-3">
            <div className="form-check form-switch">
              <input
                className="form-check-input"
                type="checkbox"
                role="switch"
                id="terceros-mostrar-inactivos"
                checked={incluirInactivos}
                onChange={(evento) => {
                  setIncluirInactivos(evento.target.checked);
                  setPagina(1);
                }}
              />
              <label className="form-check-label" htmlFor="terceros-mostrar-inactivos">
                Mostrar inactivos
              </label>
            </div>
          </div>
          <div className="col-12 col-lg-2 text-lg-end">
            <Button
              theme="primary"
              icon="bi-plus-lg"
              label="Nuevo"
              onClick={abrirAlta}
              disabled={procesando}
            />
          </div>
        </div>

        <Table
          columns={columnas}
          data={visibles}
          rowKey={(tercero) => tercero.id}
          hover
          responsive
          emptyMessage="No hay Terceros que coincidan con los filtros."
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

      <TerceroFormModal
        key={formulario.sesion}
        abierto={formulario.abierto}
        tercero={formulario.tercero}
        onGuardar={alGuardar}
        onCerrar={cerrarFormulario}
      />

      <TerceroConfirmModal
        abierto={confirmacion.abierto}
        procesando={procesando}
        titulo={desactivando ? "Desactivar Tercero" : "Reactivar Tercero"}
        tema={desactivando ? "danger" : "success"}
        textoConfirmar={desactivando ? "Desactivar" : "Reactivar"}
        mensaje={
          confirmacion.tercero === null ? null : desactivando ? (
            <p className="mb-0">
              ¿Confirmas desactivar a <strong>{confirmacion.tercero.nombre}</strong>? Dejará de
              aparecer en el listado, pero conservará sus datos y podrás reactivarlo.
            </p>
          ) : (
            <p className="mb-0">
              ¿Confirmas reactivar a <strong>{confirmacion.tercero.nombre}</strong>? Volverá a estar
              disponible para nuevas operaciones.
            </p>
          )
        }
        onConfirmar={confirmar}
        onCerrar={cerrarConfirmacion}
      />
    </>
  );
}
