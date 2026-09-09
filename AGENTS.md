<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## MCPs

- Playwright Screenshots y cualquier cosa relacionada a Playwright tiene que estar en la carpeta .playwright-mcp.

- Context7 Usaremos este MCP para traer la documentacionn actualizadaa del framework.

## Reglas de Diseño

Este proyecto sigue un sistema de diseño definido en un único archivo fuente.
**Antes de crear o modificar cualquier componente de la interfaz de usuario (UI), layout o página, DEBES leer y seguir estrictamente las directrices del archivo `DESIGN.md` en la raíz del proyecto.**

Todas las decisiones sobre colores, tipografía, espaciado, redondeo de esquinas y patrones de componentes deben extraerse exclusivamente de `DESIGN.md`.

## Comandos

- Dev server: `npm run dev` → http://localhost:3000
- Lint: `npm run lint` (ESLint 9, flat config en `eslint.config.mjs`)
- Build: `npm run build`
- No hay suite de tests ni script de typecheck; verifica tipos con `npx tsc --noEmit`
- Si editas `DESIGN.md`, valídalo con `npx @google/design.md lint DESIGN.md` (ver "Iteration Guide" dentro del archivo)

## Stack y estructura

- Next.js 16.3.4 + React 19 + TypeScript strict. No hay carpeta `src/`: el App Router vive en `app/` y el alias `@/*` apunta a la raíz del repo (tsconfig), así que los componentes/librerías nuevos van en carpetas raíz como `components/` o `lib/`.
- Tailwind CSS v4, sin `tailwind.config.*`: el tema se declara en CSS con `@theme` dentro de `app/globals.css` (config PostCSS en `postcss.config.mjs`). Los tokens del sistema de diseño (`background`, `foreground`, fuentes) deben definirse ahí, no en config JS.
- El código actual es solo el boilerplate inicial (`app/layout.tsx`, `app/page.tsx`) de un proyecto de gestión de pagos; aún no hay rutas de API, componentes propios ni librerías de UI instaladas.

## Spec Driven Development - Skills

- /spec Usaremos esta habilidad para crear especificaciones.
- /spec-impl Usaremos esta skill para hacer las implementaciones.
