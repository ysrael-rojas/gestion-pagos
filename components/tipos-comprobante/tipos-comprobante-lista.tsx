"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Pagination, Table, type TableColumn } from "@adminlte/react";
import type { TipoComprobante } from "@/lib/tipos-comprobante/dominio";
import { desactivar, listar, reactivar } from "@/lib/tipos-comprobante/repo";
import { TipoComprobanteConfirmModal } from "./tipo-comprobante-confirm-modal";
import { TipoComprobanteFormModal } from "./tipo-comprobante-form-modal";

const POR_PAGINA = 10;

interface EstadoFormulario {
  abierto: boolean;
  tipo: TipoComprobante | null;
  sesion: number;
}

interface EstadoConfirmacion {
  abierto: boolean;
  tipo: TipoComprobante | null;
  accion: "desactivar" | "reactivar";
}

export function TiposComprobanteLista() {
  const [tipos, setTipos] = useState<TipoComprobante[]>([]);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [formulario, setFormulario] = useState<EstadoFormulario>({
    abierto: false,
    tipo: null,
    sesion: 0,
  });
  const [confirmacion, setConfirmacion] = useState<EstadoConfirmacion>({
    abierto: false,
    tipo: null,
    accion: "desactivar",
  });

  useEffect(() => {
    const id = setTimeout(() => setTipos(listar()), 0);
    return () => clearTimeout(id);
  }, []);

  const abrirAlta = useCallback(
    () => setFormulario((previo) => ({ abierto: true, tipo: null, sesion: previo.sesion + 1 })),
    [],
  );
  const abrirEdicion = useCallback(
    (tipo: TipoComprobante) =>
      setFormulario((previo) => ({ abierto: true, tipo, sesion: previo.sesion + 1 })),
    [],
  );
  const cerrarFormulario = useCallback(
    () => setFormulario((previo) => ({ ...previo, abierto: false })),
    [],
  );
  const alGuardar = useCallback((guardado: TipoComprobante) => {
    setFormulario((previo) => ({ ...previo, abierto: false }));
    setErrorGeneral(null);
    setTipos((previo) =>
      previo.some((tipo) => tipo.id === guardado.id)
        ? previo.map((tipo) => (tipo.id === guardado.id ? guardado : tipo))
        : [...previo, guardado],
    );
  }, []);

  const abrirConfirmacion = useCallback(
    (tipo: TipoComprobante, accion: "desactivar" | "reactivar") =>
      setConfirmacion({ abierto: true, tipo, accion }),
    [],
  );
  const cerrarConfirmacion = useCallback(
    () => setConfirmacion((previo) => ({ ...previo, abierto: false })),
    [],
  );
  const confirmar = useCallback(() => {
    const { tipo, accion } = confirmacion;
    if (!tipo) {
      setConfirmacion((previo) => ({ ...previo, abierto: false }));
      return;
    }

    setErrorGeneral(null);

    const resultado = accion === "desactivar" ? desactivar(tipo.id) : reactivar(tipo.id);

    if (!resultado.ok) {
      setErrorGeneral(resultado.errores.general ?? "No se pudo completar la operación.");
      setConfirmacion((previo) => ({ ...previo, abierto: false }));
      return;
    }

    setTipos((previo) =>
      previo.map((actual) => (actual.id === resultado.valor.id ? resultado.valor : actual)),
    );
    setConfirmacion((previo) => ({ ...previo, abierto: false }));
  }, [confirmacion]);

  const totalPaginas = Math.max(1, Math.ceil(tipos.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const visibles = tipos.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const columnas: TableColumn<TipoComprobante>[] = [
    {
      key: "nombre",
      header: "Nombre",
      render: (tipo) => tipo.nombre,
    },
    {
      key: "estado",
      header: "Estado",
      render: (tipo) =>
        tipo.activo ? (
          <Badge theme="success">Activo</Badge>
        ) : (
          <Badge theme="secondary">Inactivo</Badge>
        ),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "end",
      render: (tipo) => (
        <div className="d-flex justify-content-end gap-1">
          <Button
            theme="secondary"
            outline
            size="sm"
            icon="bi-pencil"
            aria-label={`Editar ${tipo.nombre}`}
            onClick={() => abrirEdicion(tipo)}
          />
          {tipo.activo ? (
            <Button
              theme="danger"
              outline
              size="sm"
              icon="bi-slash-circle"
              aria-label={`Desactivar ${tipo.nombre}`}
              onClick={() => abrirConfirmacion(tipo, "desactivar")}
            />
          ) : (
            <Button
              theme="success"
              outline
              size="sm"
              icon="bi-arrow-clockwise"
              aria-label={`Reactivar ${tipo.nombre}`}
              onClick={() => abrirConfirmacion(tipo, "reactivar")}
            />
          )}
        </div>
      ),
    },
  ];

  const desactivando = confirmacion.accion === "desactivar";

  return (
    <>
      <Card title="Listado de tipos de comprobante">
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
          <Button theme="primary" icon="bi-plus-lg" label="Nuevo tipo" onClick={abrirAlta} />
        </div>

        <Table
          columns={columnas}
          data={visibles}
          rowKey={(tipo) => tipo.id}
          hover
          responsive
          emptyMessage="No hay tipos de comprobante."
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

      <TipoComprobanteFormModal
        key={formulario.sesion}
        abierto={formulario.abierto}
        tipo={formulario.tipo}
        onGuardar={alGuardar}
        onCerrar={cerrarFormulario}
      />

      <TipoComprobanteConfirmModal
        abierto={confirmacion.abierto}
        titulo={desactivando ? "Desactivar tipo" : "Reactivar tipo"}
        tema={desactivando ? "danger" : "success"}
        textoConfirmar={desactivando ? "Desactivar" : "Reactivar"}
        mensaje={
          confirmacion.tipo === null ? null : desactivando ? (
            <p className="mb-0">
              ¿Desactivar el tipo «{confirmacion.tipo.nombre}»? No aparecerá en nuevos
              comprobantes.
            </p>
          ) : (
            <p className="mb-0">¿Reactivar el tipo «{confirmacion.tipo.nombre}»?</p>
          )
        }
        onConfirmar={confirmar}
        onCerrar={cerrarConfirmacion}
      />
    </>
  );
}
