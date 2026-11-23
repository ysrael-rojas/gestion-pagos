"use client";

// Provider de cuentas, cierres y arqueos de caja y banco (C5 del vertical de cajas-bancos).
//
// Fuente: `components/cajas-bancos/cajas-bancos-provider.tsx` del origen (131 lineas) mas las
// lecturas y escrituras del cuadre que el origen pedia desde cada pantalla (`lib/caja/caja.ts` y
// `lib/caja/arqueos.ts`). Reparto:
//
//   cuentas   `accounts` (fila completa) + `addAccount` / `updateAccount` / `removeAccount`, que
//             escriben y despues refrescan, sin actualizacion optimista: la tabla nunca muestra
//             una fila que el servidor rechazo. Es el mismo contrato que `ClientesProvider`.
//   cuadre    `loadCuadre` (saldo a hoy, ultimo cierre, periodo sugerido, historicos de cierres y
//             arqueos de UNA cuenta), `loadCloseDetail` (el arqueo por denominacion de un cierre)
//             y `loadStatement` (los recibos del periodo del cierre elegido).
//   escrituras del cuadre  `closeAccount` (irreversible, S4) y `registerCount`.
//   ajustes   `defaultPeriodicity`, `differenceTolerance` y `penUsdRate` leidos de `GET /settings`
//             con los fallbacks de `lib/cajas-bancos/settings.ts`. Solo se LEE: la siembra es
//             `POST /settings/ensure` y la dispara la pantalla de configuracion (C7), nunca un
//             render (S7).
//
// QUE NO VIVE ACA: la posicion de una cuenta a una fecha (`getCashPosition`), los saldos de todas
// (`listCashPositionsConsolidated`) y el ultimo movimiento por cuenta (`listLastMovementDates`)
// siguen en `lib/cajas-bancos/caja.ts`, que es la capa de transporte de posiciones de C3. El
// provider los consume, no los reimplementa.
//
// DESVIO DELIBERADO (lo impone el API, no una preferencia): `GET /cash-accounts` devuelve el
// catalogo de CINCO columnas que consume el formulario de pagos (`CashAccountCatalogItem`), y la
// tabla de cuentas y el formulario necesitan la fila completa (banco, nro de cuenta, saldo
// inicial, periodicidad, caja chica...). El API expone esa fila en `GET /cash-accounts/:id`, asi
// que `refresh` hidrata con una lectura por cuenta en paralelo: N+1 llamadas al puente en vez del
// `select *` unico que hacia PostgREST. Se eligio eso antes que dos cosas peores: mostrar la tabla
// con columnas vacias o inventar un campo. Con una decena de cuentas por dueno el costo es
// acotado; si el catalogo crece, la ruta que falta es un `GET /cash-accounts?full=1`.
//
// NINGUN ERROR SE TRADUCE ACA: el API ya devuelve los mensajes del vertical (`cash.errors.ts`, con
// el texto de la RPC para el cierre) y el `ApiError` viaja con ese texto; el `mapError` del origen,
// que traducia SQLSTATE de PostgreSQL, no tiene equivalente porque el navegador ya no habla con
// Postgres.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CashCloseFormValues, CashCountFormValues } from "@gestion/shared";
import type {
  CashCloseDetail,
  CashCloseRecord,
  CashCountRecord,
  ClosingPeriodicity,
  Payment,
} from "@/lib/api/client";
import {
  createCashClose,
  createCashCount,
  getCashClose,
  getSettings,
  listAccountStatement,
  listCashCloses,
  listCashCounts,
} from "@/lib/api/client";
import { getCashPosition } from "@/lib/cajas-bancos/caja";
import { addDays, suggestedPeriodEnd } from "@/lib/cajas-bancos/periodo";
import {
  cashDifferenceToleranceFrom,
  closingPeriodicityFrom,
  penUsdRateFrom,
} from "@/lib/cajas-bancos/settings";
import type { CashAccountFormMutation, CashAccountRecord } from "@/lib/cuentas/entidades";
import {
  createCashAccount,
  getCashAccount,
  listCashAccounts,
  softDeleteCashAccount,
  updateCashAccount,
} from "@/lib/cuentas/entidades";

/** Estado completo del cuadre de una cuenta: lo que pinta la pantalla de cuadres de una vez. */
export interface AccountCuadre {
  /** Saldo a hoy que calculo la base (S2). */
  position: number;
  lastClose: CashCloseRecord | null;
  /** Periodo que la UI propone al abrir el modal de cierre. */
  proposed: { periodStart: string; periodEnd: string };
  closes: CashCloseRecord[];
  counts: CashCountRecord[];
}

interface CajasBancosContextValue {
  accounts: CashAccountRecord[];
  isLoading: boolean;
  error: string | null;
  /** Periodicidad global de cierre (`default_closing_periodicity`), ya con su fallback. */
  defaultPeriodicity: ClosingPeriodicity;
  /** Tolerancia de diferencia vigente (`cash_difference_tolerance`), con su fallback. */
  differenceTolerance: number;
  /** Tasa PEN/USD (`pen_usd_rate`); `null` si no hay fila o no es un numero. */
  penUsdRate: number | null;
  refresh: () => Promise<void>;
  addAccount: (values: CashAccountFormMutation) => Promise<void>;
  updateAccount: (id: string, values: CashAccountFormMutation) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  loadCuadre: (account: CashAccountRecord, today: string) => Promise<AccountCuadre>;
  loadCloseDetail: (closeId: string) => Promise<CashCloseDetail>;
  loadStatement: (accountId: string, from: string, to: string) => Promise<Payment[]>;
  /** Arqueos de una cuenta, del mas reciente al mas antiguo. */
  loadCounts: (accountId: string) => Promise<CashCountRecord[]>;
  closeAccount: (values: CashCloseFormValues) => Promise<CashCloseDetail>;
  registerCount: (values: CashCountFormValues) => Promise<CashCountRecord>;
}

const CajasBancosContext = createContext<CajasBancosContextValue | null>(null);

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado. Intenta nuevamente.";
}

export function CajasBancosProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<CashAccountRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultPeriodicity, setDefaultPeriodicity] = useState<ClosingPeriodicity>(
    closingPeriodicityFrom({}),
  );
  const [differenceTolerance, setDifferenceTolerance] = useState(() =>
    cashDifferenceToleranceFrom({}),
  );
  const [penUsdRate, setPenUsdRate] = useState<number | null>(null);
  const isMounted = useRef(true);

  /**
   * Catalogo + fila completa de cada cuenta (ver el DESVIO del encabezado).
   *
   * `allSettled` y no `all`: si una cuenta se borra entre el listado y su lectura, su `GET`
   * responde 404 y esa cuenta simplemente no aparece, en vez de tumbar la tabla entera por una
   * fila que ya no existe.
   */
  const refresh = useCallback(async () => {
    try {
      const catalog = await listCashAccounts();
      const records = await Promise.allSettled(
        catalog.map((account) => getCashAccount(account.id)),
      );

      if (!isMounted.current) {
        return;
      }

      setAccounts(
        records
          .filter(
            (result): result is PromiseFulfilledResult<CashAccountRecord> =>
              result.status === "fulfilled",
          )
          .map((result) => result.value),
      );
      setError(null);
    } catch (err) {
      if (!isMounted.current) {
        return;
      }

      setError(getErrorMessage(err));
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  /**
   * Ajustes del dueno: periodicidad por defecto, tolerancia y tipo de cambio.
   *
   * Es una lectura pura (`GET /settings` devuelve `{}` sin filas) y un fallo no puede romper la
   * pantalla: los tres lectores de `settings.ts` ya tienen el default del origen, asi que aca se
   * conserva el default y se sigue. El cierre real lo valida la base con los ajustes vigentes (S4),
   * asi que un default desactualizado en la UI solo cambia el numero que se muestra.
   */
  const loadSettings = useCallback(async () => {
    try {
      const settings = await getSettings();

      if (!isMounted.current) {
        return;
      }

      setDefaultPeriodicity(closingPeriodicityFrom(settings));
      setDifferenceTolerance(cashDifferenceToleranceFrom(settings));
      setPenUsdRate(penUsdRateFrom(settings));
    } catch {
      // Silencio deliberado: los tres valores ya arrancan con el default del vertical.
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;

    void (async () => {
      await Promise.all([refresh(), loadSettings()]);
    })();

    return () => {
      isMounted.current = false;
    };
  }, [refresh, loadSettings]);

  const addAccount = useCallback(
    async (values: CashAccountFormMutation) => {
      await createCashAccount(values);
      await refresh();
    },
    [refresh],
  );

  const updateAccount = useCallback(
    async (id: string, values: CashAccountFormMutation) => {
      await updateCashAccount(id, values);
      await refresh();
    },
    [refresh],
  );

  const removeAccount = useCallback(
    async (id: string) => {
      await softDeleteCashAccount(id);
      await refresh();
    },
    [refresh],
  );

  /**
   * Lecturas del cuadre de una cuenta: saldo a hoy, ultimo cierre, periodo sugerido e historicos.
   *
   * Las cinco lecturas van en paralelo, como en `fetchAccount` del origen
   * (`cuadres-view.tsx:346-367`). El periodo sugerido se arma con las reglas puras de
   * `lib/cajas-bancos/periodo.ts`: arranca al dia siguiente del ultimo cierre (o en la fecha de
   * apertura de la cuenta) y, si el fin sugerido por la periodicidad quedara antes del inicio, se
   * usa el inicio (una cuenta con cierres viejos no propone un periodo invertido).
   *
   * El cierre real lo decide el usuario y lo valida la base: aca no se calcula ni se compara ningun
   * importe (S2/S4).
   */
  const loadCuadre = useCallback(
    async (account: CashAccountRecord, today: string): Promise<AccountCuadre> => {
      const periodicity = account.closingPeriodicity ?? defaultPeriodicity;
      const [position, closes, counts] = await Promise.all([
        getCashPosition(account.id, today),
        listCashCloses(account.id),
        listCashCounts(account.id),
      ]);

      const lastClose = closes[0] ?? null;
      const periodStart = lastClose
        ? addDays(lastClose.periodEnd, 1)
        : account.openingBalanceDate;
      const suggested = suggestedPeriodEnd(periodicity, today);

      return {
        position,
        lastClose,
        proposed: {
          periodStart,
          periodEnd: suggested < periodStart ? periodStart : suggested,
        },
        closes,
        counts,
      };
    },
    [defaultPeriodicity],
  );

  /** Un cierre con su arqueo por denominacion (`GET /cash-closes/:id`, vacio en bancos). */
  const loadCloseDetail = useCallback((closeId: string) => getCashClose(closeId), []);

  /**
   * Arqueos de una cuenta. Se vuelve a pedir despues de registrar uno: la fila creada llega en la
   * respuesta del `POST`, pero el historial completo no, y la tabla muestra el historial.
   */
  const loadCounts = useCallback((accountId: string) => listCashCounts(accountId), []);

  /** Recibos del periodo de un cierre (`listAccountStatement` del origen). */
  const loadStatement = useCallback(
    (accountId: string, from: string, to: string) =>
      listAccountStatement(accountId, from, to),
    [],
  );

  /**
   * Cierra un periodo. El cierre es IRREVERSIBLE (S4): no hay reapertura y esta funcion no ofrece
   * ninguna. Las reglas (periodo ya cerrado, fecha futura, tolerancia sin motivo) las aplica la RPC
   * `close_cash_account` y el mensaje del `ApiError` se muestra tal cual.
   */
  const closeAccount = useCallback((values: CashCloseFormValues) => createCashClose(values), []);

  /** Registra un arqueo que no cierra periodo (`register_cash_count`). */
  const registerCount = useCallback(
    (values: CashCountFormValues) => createCashCount(values),
    [],
  );

  const value = useMemo(
    () => ({
      accounts,
      isLoading,
      error,
      defaultPeriodicity,
      differenceTolerance,
      penUsdRate,
      refresh,
      addAccount,
      updateAccount,
      removeAccount,
      loadCuadre,
      loadCloseDetail,
      loadStatement,
      loadCounts,
      closeAccount,
      registerCount,
    }),
    [
      accounts,
      isLoading,
      error,
      defaultPeriodicity,
      differenceTolerance,
      penUsdRate,
      refresh,
      addAccount,
      updateAccount,
      removeAccount,
      loadCuadre,
      loadCloseDetail,
      loadStatement,
      loadCounts,
      closeAccount,
      registerCount,
    ],
  );

  return (
    <CajasBancosContext.Provider value={value}>
      {children}
    </CajasBancosContext.Provider>
  );
}

export function useCajasBancos() {
  const context = useContext(CajasBancosContext);

  if (!context) {
    throw new Error("useCajasBancos debe usarse dentro de un CajasBancosProvider");
  }

  return context;
}
