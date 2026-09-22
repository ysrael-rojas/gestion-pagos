"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Pagination, Table, type TableColumn } from "@adminlte/react";
import {
  ETIQUETAS_CONDICION,
  type ComprobanteCompra,
  type CondicionPago,
} from "@/lib/comprobantes/dominio";
import { desactivar, listar, reactivar, type ComprobanteCompraVista } from "@/lib/comprobantes/repo";
import { listar as listarTipos } from "@/lib/tipos-comprobante/repo";
import type { TipoComprobante } from "@/lib/tipos-comprobante/dominio";
import { ComprobanteConfirmModal } from "./comprobante-confirm-modal";
import { ComprobanteFormModal } from "./comprobante-form-modal";

const POR_PAGINA = 10;

const FORMATO_MONEDA = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
});

function formatearFecha(fecha: string | null): string {
  if (fecha === null) {
    return "—";
  }

  const [anio, mes, dia] = fecha.split("-");

  return anio && mes && dia ? `${dia}/${mes}/${anio}` : fecha;
}

interface FiltrosComprobantes {
  texto: string;
  tipoComprobanteId: string;
  condicionPago: CondicionPago | "";
  desde: string;
  hasta: string;
  incluirInactivos: boolean;
}

function filtrar(
  comprobantes: ComprobanteCompraVista[],
  filtros: FiltrosComprobantes,
): ComprobanteCompraVista[] {
  const busqueda = filtros.texto.trim().toLowerCase();

  return comprobantes
    .filter((comprobante) => filtros.incluirInactivos || comprobante.activo)
    .filter((comprobante) =>
      filtros.tipoComprobanteId === ""
        ? true
        : comprobante.tipoComprobanteId === filtros.tipoComprobanteId,
    )
    .filter((comprobante) =>
      filtros.condicionPago === "" ? true : comprobante.condicionPago === filtros.condicionPago,
    )
    .filter((comprobante) => (filtros.desde === "" ? true : comprobante.fechaEmision >= filtros.desde))
    .filter((comprobante) => (filtros.hasta === "" ? true : comprobante.fechaEmision <= filtros.hasta))
    .filter((comprobante) => {
      if (busqueda === "") {
        return true;
      }

      return (
        comprobante.proveedor.toLowerCase().includes(busqueda) ||
        comprobante.numero.toLowerCase().includes(busqueda)
      );
    })
    .sort((a, b) => b.fechaEmision.localeCompare(a.fechaEmision));
}

interface EstadoFormulario {
  abierto: boolean;
  comprobante: ComprobanteCompra | null;
  sesion: number;
}

interface EstadoConfirmacion {
  abierto: boolean;
  comprobante: ComprobanteCompra | null;
  accion: "desactivar" | "reactivar";
}

export function ComprobantesLista() {
  const [comprobantes, setComprobantes] = useState<ComprobanteCompraVista[]>([]);
  const [tipos, setTipos] = useState<TipoComprobante[]>([]);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [tipoComprobanteId, setTipoComprobanteId] = useState("");
  const [condicionPago, setCondicionPago] = useState<CondicionPago | "">("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [formulario, setFormulario] = useState<EstadoFormulario>({
    abierto: false,
    comprobante: null,
    sesion: 0,
  });
  const [confirmacion, setConfirmacion] = useState<EstadoConfirmacion>({
    abierto: false,
    comprobante: null,
    accion: "desactivar",
  });

  useEffect(() => {
    const id = setTimeout(() => {
      setComprobantes(listar());
      setTipos(listarTipos());
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const filtrados = useMemo(
    () =>
      filtrar(comprobantes, {
        texto,
        tipoComprobanteId,
        condicionPago,
        desde,
        hasta,
        incluirInactivos,
      }),
    [comprobantes, texto, tipoComprobanteId, condicionPago, desde, hasta, incluirInactivos],
  );

  const abrirAlta = useCallback(
    () =>
      setFormulario((previo) => ({ abierto: true, comprobante: null, sesion: previo.sesion + 1 })),
    [],
  );
  const abrirEdicion = useCallback(
    (comprobante: ComprobanteCompra) =>
      setFormulario((previo) => ({ abierto: true, comprobante, sesion: previo.sesion + 1 })),
    [],
  );
  const cerrarFormulario = useCallback(
    () => setFormulario((previo) => ({ ...previo, abierto: false })),
    [],
  );
  const alGuardar = useCallback(() => {
    setFormulario((previo) => ({ ...previo, abierto: false }));
    setErrorGeneral(null);
    setComprobantes(listar());
  }, []);

  const abrirConfirmacion = useCallback(
    (comprobante: ComprobanteCompra, accion: "desactivar" | "reactivar") =>
      setConfirmacion({ abierto: true, comprobante, accion }),
    [],
  );
  const cerrarConfirmacion = useCallback(
    () => setConfirmacion((previo) => ({ ...previo, abierto: false })),
    [],
  );
  const confirmar = useCallback(() => {
    const { comprobante, accion } = confirmacion;
    if (!comprobante) {
      setConfirmacion((previo) => ({ ...previo, abierto: false }));
      return;
    }

    setErrorGeneral(null);

    const resultado =
      accion === "desactivar" ? desactivar(comprobante.id) : reactivar(comprobante.id);

    if (!resultado.ok) {
      setErrorGeneral(resultado.errores.general ?? "No se pudo completar la operación.");
      setConfirmacion((previo) => ({ ...previo, abierto: false }));
      return;
    }

    setComprobantes(listar());
    setConfirmacion((previo) => ({ ...previo, abierto: false }));
  }, [confirmacion]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const visibles = filtrados.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA);

  const columnas: TableColumn<ComprobanteCompraVista>[] = [
    {
      key: "fechaEmision",
      header: "Fecha emisión",
      render: (comprobante) => formatearFecha(comprobante.fechaEmision),
    },
    {
      key: "tipo",
      header: "Tipo",
      render: (comprobante) => comprobante.tipoNombre,
    },
    {
      key: "numero",
      header: "Nro",
      render: (comprobante) => comprobante.numero,
    },
    {
      key: "proveedor",
      header: "Proveedor",
      render: (comprobante) => comprobante.proveedor,
    },
    {
      key: "subtotal",
      header: "Subtotal",
      align: "end",
      render: (comprobante) => FORMATO_MONEDA.format(comprobante.subtotal),
    },
    {
      key: "igv",
      header: "IGV",
      align: "end",
      render: (comprobante) => FORMATO_MONEDA.format(comprobante.igv),
    },
    {
      key: "total",
      header: "Total",
      align: "end",
      render: (comprobante) => FORMATO_MONEDA.format(comprobante.total),
    },
    {
      key: "condicion",
      header: "Condición",
      render: (comprobante) => ETIQUETAS_CONDICION[comprobante.condicionPago],
    },
    {
      key: "vencimiento",
      header: "Vencimiento",
      render: (comprobante) => formatearFecha(comprobante.fechaVencimiento),
    },
    {
      key: "estado",
      header: "Estado",
      render: (comprobante) =>
        comprobante.activo ? (
          <Badge theme="success">Activo</Badge>
        ) : (
          <Badge theme="secondary">Inactivo</Badge>
        ),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "end",
      render: (comprobante) => (
        <div className="d-flex justify-content-end gap-1">
          <Button
            theme="secondary"
            outline
            size="sm"
            icon="bi-pencil"
            aria-label={`Editar ${comprobante.numero}`}
            onClick={() => abrirEdicion(comprobante)}
          />
          {comprobante.activo ? (
            <Button
              theme="danger"
              outline
              size="sm"
              icon="bi-slash-circle"
              aria-label={`Desactivar ${comprobante.numero}`}
              onClick={() => abrirConfirmacion(comprobante, "desactivar")}
            />
          ) : (
            <Button
              theme="success"
              outline
              size="sm"
              icon="bi-arrow-clockwise"
              aria-label={`Reactivar ${comprobante.numero}`}
              onClick={() => abrirConfirmacion(comprobante, "reactivar")}
            />
          )}
        </div>
      ),
    },
  ];

  const desactivando = confirmacion.accion === "desactivar";

  return (
    <>
      <Card title="Listado de comprobantes de compra">
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
              placeholder="Buscar por proveedor o número"
              aria-label="Buscar comprobantes"
              value={texto}
              onChange={(evento) => {
                setTexto(evento.target.value);
                setPagina(1);
              }}
            />
          </div>
          <div className="col-12 col-sm-6 col-lg-2">
            <select
              className="form-select"
              aria-label="Filtrar por tipo de comprobante"
              value={tipoComprobanteId}
              onChange={(evento) => {
                setTipoComprobanteId(evento.target.value);
                setPagina(1);
              }}
            >
              <option value="">Todos los tipos</option>
              {tipos.map((tipo) => (
                <option key={tipo.id} value={tipo.id}>
                  {tipo.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12 col-sm-6 col-lg-2">
            <select
              className="form-select"
              aria-label="Filtrar por condición de pago"
              value={condicionPago}
              onChange={(evento) => {
                setCondicionPago(evento.target.value as CondicionPago | "");
                setPagina(1);
              }}
            >
              <option value="">Todas las condiciones</option>
              <option value="contado">Contado</option>
              <option value="credito">Crédito</option>
            </select>
          </div>
          <div className="col-12 col-sm-6 col-lg-2">
            <input
              type="date"
              className="form-control"
              aria-label="Fecha de emisión desde"
              value={desde}
              onChange={(evento) => {
                setDesde(evento.target.value);
                setPagina(1);
              }}
            />
          </div>
          <div className="col-12 col-sm-6 col-lg-2">
            <input
              type="date"
              className="form-control"
              aria-label="Fecha de emisión hasta"
              value={hasta}
              onChange={(evento) => {
                setHasta(evento.target.value);
                setPagina(1);
              }}
            />
          </div>
        </div>

        <div className="row g-2 align-items-center mb-3">
          <div className="col-12 col-sm-6 col-lg-4">
            <div className="form-check form-switch">
              <input
                className="form-check-input"
                type="checkbox"
                role="switch"
                id="comprobantes-mostrar-inactivos"
                checked={incluirInactivos}
                onChange={(evento) => {
                  setIncluirInactivos(evento.target.checked);
                  setPagina(1);
                }}
              />
              <label className="form-check-label" htmlFor="comprobantes-mostrar-inactivos">
                Mostrar inactivos
              </label>
            </div>
          </div>
          <div className="col-12 col-sm-6 col-lg-8 text-lg-end">
            <Button
              theme="primary"
              icon="bi-plus-lg"
              label="Nuevo comprobante"
              onClick={abrirAlta}
            />
          </div>
        </div>

        <Table
          columns={columnas}
          data={visibles}
          rowKey={(comprobante) => comprobante.id}
          hover
          responsive
          emptyMessage="No hay comprobantes que coincidan con los filtros."
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

      <ComprobanteFormModal
        key={formulario.sesion}
        abierto={formulario.abierto}
        comprobante={formulario.comprobante}
        onGuardar={alGuardar}
        onCerrar={cerrarFormulario}
      />

      <ComprobanteConfirmModal
        abierto={confirmacion.abierto}
        titulo={desactivando ? "Desactivar comprobante" : "Reactivar comprobante"}
        tema={desactivando ? "danger" : "success"}
        textoConfirmar={desactivando ? "Desactivar" : "Reactivar"}
        mensaje={
          confirmacion.comprobante === null ? null : desactivando ? (
            <p className="mb-0">
              ¿Desactivar el comprobante «{confirmacion.comprobante.numero}» de «
              {confirmacion.comprobante.proveedor}»? Dejará de estar disponible pero conservará su
              historial.
            </p>
          ) : (
            <p className="mb-0">
              ¿Reactivar el comprobante «{confirmacion.comprobante.numero}» de «
              {confirmacion.comprobante.proveedor}»?
            </p>
          )
        }
        onConfirmar={confirmar}
        onCerrar={cerrarConfirmacion}
      />
    </>
  );
}
