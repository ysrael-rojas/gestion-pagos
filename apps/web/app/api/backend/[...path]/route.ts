// Puente HTTP del navegador hacia apps/api.
//
// Por que existe: `apps/api` no habilita CORS (T5b) y la cookie de sesion es `HttpOnly`, asi que
// el navegador no puede llamar al API en otro origen: ni leeria la respuesta ni mandaria la
// credencial. Todo lo que la UI necesita ya viaja por esta ruta, que corre en el servidor de
// Next, reenvia la cookie y devuelve la respuesta del API **tal cual** (status y cuerpo).
//
// Que NO hace: no transforma nada, no valida nada y no agrega campos. El `owner_id` no existe en
// esta capa: lo pone `withOwner` en apps/api a partir de la sesion.
//
// Lista blanca de prefijos y metodos: el puente solo alcanza los verticales portados (pagos,
// clientes, cajas-bancos, ventas y series), no cualquier ruta del API. Un path inesperado responde
// 404 sin salir del proceso.
//
// `PATCH` esta porque `PATCH /entities/:id` es la modificacion de cliente (T5c) y
// `PATCH /settings` la configuracion general de cajas-bancos (C1). Sin el, el navegador recibia
// 405 del puente y el usuario veia "El API respondio 405" en la pantalla de edicion: el sintoma
// parecia del API y era de esta lista.
import { API_BASE_URL } from "@/lib/api/client";

/** Prefijos de apps/api que el frontend consume hoy. */
const ALLOWED_PREFIXES = new Set([
  "payments",
  "cartera",
  "vouchers",
  "entities",
  "cash-accounts",
  // C3 del vertical de cajas: posiciones y fechas de ultimo movimiento. Sin estos dos prefijos
  // el navegador recibe 404 del puente aunque la ruta exista en el API.
  "cash-positions",
  "last-movement-dates",
  // C4: cierres y arqueos. Las dos escrituras van por POST (las RPC del API), igual que el resto.
  "cash-closes",
  "cash-counts",
  // C6: transferencias entre cuentas y caja chica (vales y reposicion). Las cuatro escrituras son
  // RPC del API por POST; sin estos dos prefijos el navegador recibe 404 del puente.
  "cash-transfers",
  "petty-cash",
  // C7: conciliacion bancaria (el acta del periodo, por GET y POST) y el agregado del mes del
  // dashboard. Los dos son rutas nuevas del vertical; sin el prefijo, el navegador recibe 404 del
  // puente aunque la ruta exista en el API.
  "bank-reconciliations",
  "cash-flow",
  "payment-methods",
  "receipt-categories",
  "catalogs",
  "settings",
  // T5 del slice 2: series de comprobante (`/configuracion/series`). El CRUD son `GET/POST /series`,
  // `PATCH /series/:id` y la baja logica por `POST /series/:id/delete`, asi que no hace falta abrir
  // el puente a `DELETE` (S9): ese verbo no existe entre los que este proxy reenvia.
  "series",
]);

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH"]);

async function proxy(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path = [] } = await context.params;
  const [prefix] = path;

  if (!prefix || !ALLOWED_PREFIXES.has(prefix) || !ALLOWED_METHODS.has(request.method)) {
    return Response.json(
      { message: "Ruta no disponible desde el navegador." },
      { status: 404 },
    );
  }

  const search = new URL(request.url).search;
  const target = `${API_BASE_URL}/${path.map((segment) => encodeURIComponent(segment)).join("/")}${search}`;
  const headers: Record<string, string> = { accept: "application/json" };
  const cookie = request.headers.get("cookie");
  const contentType = request.headers.get("content-type");
  const body = request.method === "GET" ? undefined : await request.text();

  if (cookie) headers.cookie = cookie;
  if (body !== undefined && contentType) headers["content-type"] = contentType;

  let upstream: Response;

  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);

    return Response.json(
      { message: `No se pudo conectar con el API: ${reason}` },
      { status: 502 },
    );
  }

  // Se devuelve el cuerpo como texto, sin re-serializar: el mensaje de dominio del API tiene que
  // llegar al usuario sin que este puente lo toque.
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  return proxy(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  return proxy(request, context);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  return proxy(request, context);
}
