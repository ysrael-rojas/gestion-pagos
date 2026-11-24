// Configuracion (T4/T5 del slice 2: S9 de `odd/tasks/port-vertical-series.md`).
//
// La entrada `Configuración` del navbar y el enlace `Configurar series` de la pantalla de ventas
// apuntan a `/configuracion` (el origen tenia ahi una pantalla con solapas). Hoy la unica seccion
// es la de series, asi que esta ruta REDIRIGE a `/configuracion/series` en vez de dibujar un
// contenedor vacio: sin esto, los dos enlaces seguian siendo enlaces muertos (S9, L4f).
//
// `redirect` es una excepcion de Next que corre en el servidor: el navegador recibe un 307 y nunca
// ve una pantalla intermedia. La sesion ya la garantiza el layout de `(app)`.
import { redirect } from "next/navigation";

export default function ConfiguracionPage() {
  redirect("/configuracion/series");
}
