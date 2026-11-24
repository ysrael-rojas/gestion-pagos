// Pantalla de series (T4 del slice 2: S8 de `odd/tasks/port-vertical-series.md`).
//
// Tres cosas se prueban aca, y las tres son contrato visible o contrato HTTP:
//
//   1. Los textos de S8, VERBATIM. El documento de la feature los cita completos y tres de ellos
//      ("[cambia]") dicen que el correlativo lo asigna el sistema; el resto se conserva textual.
//      El origen los partia en varias lineas de JSX con `{" "}` de por medio, asi que el texto
//      exacto solo estaba garantizado a ojo.
//   2. La fila -> modelo de tabla: etiqueta del tipo, correlativo a 6 digitos y la marca de
//      predeterminada. El correlativo se formatea con el helper de `lib/ventas/series.ts`, no con
//      una copia.
//   3. El contrato HTTP de las cuatro rutas del API (`GET/POST /series`, `PATCH /series/:id` y la
//      baja logica por `POST /series/:id/delete`). Un nombre de ruta o un verbo mal elegido no lo ve
//      el typecheck, y el borrado es POST a proposito (S9: el puente no reenvia DELETE).
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { ApiError, API_BASE_URL } from "../api/client.ts";
import type { VoucherSeriesRow } from "@gestion/shared/lib/schemas/serie.ts";
import {
  SERIES_COPY,
  createEmptySerieFormValues,
  createSerie,
  deleteSerie,
  listSeries,
  normalizeSerieCodeInput,
  toSerieEditBody,
  toSerieFormValues,
  toSerieTableRow,
  updateSerie,
} from "./series.ts";

const originalFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];

function stubFetch(body: unknown, status = 200) {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });

    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

after(() => {
  globalThis.fetch = originalFetch;
});

const ROW: VoucherSeriesRow = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  voucherType: "FACTURA",
  code: "F001",
  lastNumber: 126,
  isDefault: true,
};

const FORM_VALUES = {
  voucherType: "BOLETA" as const,
  code: "B001",
  isDefault: true,
};

describe("textos de la pantalla (S8)", () => {
  it("conserva las frases del origen, con las tres correcciones del correlativo asignado", () => {
    const { editActionLabel, deleteActionLabel, deleteDialogTitle, ...texts } =
      SERIES_COPY;

    assert.deepEqual(texts, {
      sectionTitle: "Configuración",
      sectionSubtitle: "Administra la numeración de tus comprobantes de venta.",
      pageTitle: "Series de comprobantes",
      pageSubtitle:
        "Registra las series de cada tipo de comprobante y elige cuál se usa por defecto. " +
        "El correlativo lo asigna el sistema al registrar ventas.",
      defaultHint: "Solo una serie por tipo puede quedar como predeterminada.",
      addAction: "Agregar serie",
      emptyMessage:
        "No hay series registradas. Agrega la primera para poder registrar ventas.",
      columnType: "Tipo",
      columnCode: "Serie",
      columnLastNumber: "Último correlativo",
      columnDefault: "Por defecto",
      defaultBadge: "Predeterminada",
      noDefaultMark: "—",
      createTitle: "Agregar serie",
      editTitle: "Editar serie",
      modalSubtitle:
        "Define el código de serie y si es la que se usa por defecto para ese tipo de " +
        "comprobante.",
      fieldType: "Tipo de comprobante",
      fieldCode: "Serie",
      requiredBadge: "Requerido",
      codePlaceholder: "F001",
      defaultCheckboxLabel: "Usar como serie por defecto para este tipo",
      defaultCheckboxHint:
        "Solo puede haber una serie por defecto por tipo de comprobante.",
      codeHint:
        "De 1 a 4 caracteres alfanuméricos. El correlativo lo asigna el sistema al " +
        "registrar ventas.",
      toastCreated: "Serie agregada",
      toastUpdated: "Serie actualizada",
      toastDeleted: "Serie eliminada",
      deleteDescription:
        "Dejará de usarse para nuevas ventas. Los comprobantes ya registrados no cambian.",
      deleteConfirm: "Eliminar",
      cancel: "Cancelar",
      save: "Guardar cambios",
      create: "Agregar serie",
      saving: "Guardando…",
      unexpectedError: "Ocurrió un error inesperado. Intenta nuevamente.",
    });

    // Los tres textos con el codigo de la serie interpolado (S8).
    assert.equal(editActionLabel("F001"), "Editar serie F001");
    assert.equal(deleteActionLabel("B001"), "Eliminar serie B001");
    assert.equal(deleteDialogTitle("F001"), "Eliminar serie F001");
  });
});

describe("toSerieTableRow", () => {
  it("resuelve la etiqueta del tipo, el correlativo y la marca de predeterminada", () => {
    assert.deepEqual(toSerieTableRow(ROW), {
      id: ROW.id,
      voucherType: "FACTURA",
      typeLabel: "Factura",
      code: "F001",
      lastNumber: 126,
      correlativeLabel: "000126",
      isDefault: true,
      defaultLabel: "Predeterminada",
    });
  });

  it("pinta una raya cuando la serie no es la predeterminada", () => {
    const row = toSerieTableRow({ ...ROW, voucherType: "NOTA_VENTA", isDefault: false });

    assert.equal(row.typeLabel, "Nota de venta");
    assert.equal(row.defaultLabel, "—");
  });

  it("no recorta un correlativo de mas de 6 digitos", () => {
    assert.equal(toSerieTableRow({ ...ROW, lastNumber: 1_234_567 }).correlativeLabel, "1234567");
  });
});

describe("valores del formulario", () => {
  it("arranca vacio, sin tipo y sin marcar predeterminada", () => {
    assert.deepEqual(createEmptySerieFormValues(), {
      voucherType: "",
      code: "",
      isDefault: false,
    });
  });

  it("carga la fila que se edita", () => {
    assert.deepEqual(toSerieFormValues(ROW), {
      voucherType: "FACTURA",
      code: "F001",
      isDefault: true,
    });
  });

  it("el body de la edicion NO lleva el tipo: es inmutable (S5, L4a)", () => {
    assert.deepEqual(toSerieEditBody(FORM_VALUES), { code: "B001", isDefault: true });
  });

  it("normaliza el codigo a mayusculas mientras se tipea (S8)", () => {
    assert.equal(normalizeSerieCodeInput("b001"), "B001");
    assert.equal(normalizeSerieCodeInput("F01"), "F01");
    assert.equal(normalizeSerieCodeInput(""), "");
  });
});

describe("transporte de las cuatro rutas (S9)", () => {
  it("lista las series vivas del dueno", async () => {
    stubFetch([ROW]);

    const rows = await listSeries();

    assert.equal(calls[0]?.url, `${API_BASE_URL}/series`);
    assert.equal(calls[0]?.init.method, "GET");
    assert.deepEqual(rows, [ROW]);
  });

  it("crea con el formulario completo por POST y devuelve la fila", async () => {
    stubFetch(ROW, 201);

    const created = await createSerie(FORM_VALUES);

    assert.equal(calls[0]?.url, `${API_BASE_URL}/series`);
    assert.equal(calls[0]?.init.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), FORM_VALUES);
    assert.deepEqual(created, ROW);
  });

  it("edita por PATCH sin el tipo y devuelve la fila ya guardada", async () => {
    stubFetch(ROW);

    await updateSerie(ROW.id, FORM_VALUES);

    assert.equal(calls[0]?.url, `${API_BASE_URL}/series/${ROW.id}`);
    assert.equal(calls[0]?.init.method, "PATCH");
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), {
      code: "B001",
      isDefault: true,
    });
  });

  it("da de baja por POST /series/:id/delete (no es un DELETE HTTP)", async () => {
    stubFetch(null, 204);

    const result = await deleteSerie(ROW.id);

    assert.equal(calls[0]?.url, `${API_BASE_URL}/series/${ROW.id}/delete`);
    assert.equal(calls[0]?.init.method, "POST");
    // 204 sin cuerpo: la pantalla no recibe fila que pintar, solo recarga.
    assert.equal(result, undefined);
  });

  it("deja pasar los mensajes de S6 tal cual", async () => {
    stubFetch(
      {
        statusCode: 409,
        error: "Conflict",
        message: "Ya existe una serie con ese código para ese tipo.",
      },
      409,
    );

    await assert.rejects(
      () => createSerie(FORM_VALUES),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        assert.equal(error.message, "Ya existe una serie con ese código para ese tipo.");

        return true;
      },
    );
  });
});
