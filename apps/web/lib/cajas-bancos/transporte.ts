// Transporte HTTP de transferencias y caja chica (C6 del vertical de cajas-bancos).
//
// El `fetch` NO se duplica: `requestJson` es el `request` de `lib/api/client.ts`, el unico
// transporte del frontend. El cliente resuelve la base segun donde corra (servidor `API_BASE_URL`,
// navegador `/api/backend`), convierte un estado no-2xx en `ApiError` con el `message` del API sin
// tocar y devuelve `undefined` en 204.
//
// Antes esto era una copia de las seis lineas del `fetch` porque el `request` del cliente no se
// exportaba. Copiarlo dos veces es como empiezan a divergir las dos cosas que no pueden divergir
// (manejo de errores y credenciales), y C7 iba a necesitar una tercera, asi que el cliente expone
// `request` y aca solo se le pone el nombre de la superficie del vertical: cambiar de transporte es
// este archivo, no los seis modulos que lo importan (`transferencias.ts`, `caja-chica.ts`,
// `movimientos.ts`, `cargos.ts`, `conciliacion.ts` y las pantallas que los consumen).
//
// El navegador pega en `/api/backend/cash-transfers` y `/api/backend/petty-cash`; los dos prefijos
// estan en la lista blanca de `app/api/backend/[...path]/route.ts`. Sin esa lista blanca el API
// responde y el navegador recibe 404 del puente.
//
// Tampoco se ramifica por 400 vs 404: el API usa 404 para "no existe" y 400 para el resto, pero el
// texto de la RPC ya dice cual es cual y es el que se le muestra al usuario.
export { request as requestJson } from "../api/client.ts";
