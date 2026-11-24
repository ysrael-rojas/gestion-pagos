// Listado de ventas: la raiz del vertical (port de `app/(app)/ventas/page.tsx` del origen, T5).
//
// Misma ruta y mismo componente que el origen (`VentasListadoView`), que es la pantalla de S10:
// titulo `Ventas`, subtitulo `Registra y administra tus ventas`, boton `Registrar venta`, filtros
// Desde/Hasta/Estado pago, tabla con paginacion de 10 y acciones Ver/Editar/`Registrar pago`.
//
// La pagina es de SERVIDOR y no resuelve nada: el listado pide `GET /vouchers` al montarse y lee
// los filtros de la URL el mismo (`?desde=&hasta=&estado=`), asi que no hay plomeria que pasarle
// por props (L12 del doc de la feature). El prefijo `vouchers` ya estaba en la lista blanca del
// puente `/api/backend`, con GET/POST/PATCH: este slice no tuvo que abrir nada.
//
// `VentasListadoView` usa `useSearchParams`, que en un build estatico exigiria envolverlo en
// `Suspense`. No hace falta: el layout de `(app)` llama a `getSessionUser()`, que lee `cookies()`,
// y eso vuelve dinamico el segmento entero — el mismo motivo por el que el listado de pagos
// (`app/(app)/pagos/ingresos/page.tsx`) ya convive con `useSearchParams` en su toolbar. El build
// de la web lo confirma: si algun dia el segmento se prerenderizara, el error es de build y no
// una pantalla que falla en produccion.
import { VentasListadoView } from "@/components/ventas/ventas-listado-view";

export default function VentasPage() {
  return <VentasListadoView />;
}
