// Series de comprobantes (T4 del slice 2: S8 y S9).
//
// Misma ruta que en el origen (`app/(app)/configuracion/series/page.tsx`) y la misma vista: la
// tabla, el modal de alta/edicion y el dialogo de baja logica. La pagina solo monta la vista, como
// las de cajas-bancos; las series las pide la vista por el puente `/api/backend/series` (el prefijo
// esta en la lista blanca de `app/api/backend/[...path]/route.ts`).
import { SeriesView } from "@/components/configuracion/series-view";

export default function SeriesConfiguracionPage() {
  return <SeriesView />;
}
