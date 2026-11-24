// Listado de compras: la raiz del vertical (T5, S11 de `odd/tasks/port-vertical-compras.md`).
//
// Misma pantalla que el listado de ventas (`VoucherListadoView` con `voucherKind="COMPRA"`), que es
// la de S10: titulo `Compras`, subtitulo `Registra y administra tus compras`, boton
// `Registrar compra`, filtros Desde/Hasta/Estado pago, tabla con paginacion de 10 y acciones
// Ver/Editar/`Registrar pago`.
//
// La pagina es de SERVIDOR y no resuelve nada: el listado pide `GET /purchases` al montarse y lee
// los filtros de la URL el mismo (`?desde=&hasta=&estado=`), igual que `/ventas`. El prefijo
// `purchases` ya esta en la lista blanca del puente `/api/backend` con GET/POST/PATCH (T5).
//
// `VoucherListadoView` usa `useSearchParams`, que en un build estatico exigiria envolverlo en
// `Suspense`. No hace falta: el layout de `(app)` llama a `getSessionUser()`, que lee `cookies()`, y
// eso vuelve dinamico el segmento entero, como en `/ventas` y `/pagos/ingresos`.
import { ComprasListadoView } from "@/components/compras/compras-listado-view";

export default function ComprasPage() {
  return <ComprasListadoView />;
}
