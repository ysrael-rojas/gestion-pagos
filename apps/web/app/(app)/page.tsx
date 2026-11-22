import Link from "next/link";
import { formatCurrency, paymentSchema } from "@gestion/shared";
import { getSessionUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Inventario del kit portado: `components/ui/*.tsx` del origen, sin tocar una linea.
 * La pagina lo renderiza en vez de solo importarlo, que es la unica forma de saber que el
 * kit compila **y** se hidrata (T5a).
 */
const KIT_FILES: ReadonlyArray<{ file: string; lines: number }> = [
  { file: "alert-dialog.tsx", lines: 187 },
  { file: "badge.tsx", lines: 51 },
  { file: "button.tsx", lines: 58 },
  { file: "card.tsx", lines: 102 },
  { file: "checkbox.tsx", lines: 28 },
  { file: "collapsible.tsx", lines: 21 },
  { file: "combobox.tsx", lines: 151 },
  { file: "dialog.tsx", lines: 160 },
  { file: "drawer.tsx", lines: 232 },
  { file: "dropdown-menu.tsx", lines: 267 },
  { file: "field.tsx", lines: 238 },
  { file: "input.tsx", lines: 19 },
  { file: "item.tsx", lines: 201 },
  { file: "label.tsx", lines: 19 },
  { file: "navigation-menu.tsx", lines: 167 },
  { file: "select.tsx", lines: 200 },
  { file: "separator.tsx", lines: 24 },
  { file: "sheet.tsx", lines: 138 },
  { file: "sidebar.tsx", lines: 723 },
  { file: "skeleton.tsx", lines: 13 },
  { file: "sonner.tsx", lines: 49 },
  { file: "table.tsx", lines: 115 },
  { file: "tabs.tsx", lines: 81 },
  { file: "textarea.tsx", lines: 17 },
  { file: "tooltip.tsx", lines: 65 },
];

const KIT_TOTAL_LINES = KIT_FILES.reduce((total, entry) => total + entry.lines, 0);

/**
 * Prueba en runtime de que el contrato compartido se importa por nombre de paquete: el mismo
 * `paymentSchema` que valida `apps/api` (S8), con sus mensajes en espanol tal cual. UUIDs fijos
 * para que el HTML prerenderizado sea estable.
 */
const VALID_PAYMENT = paymentSchema.safeParse({
  direction: "EGRESO",
  paymentDate: "2026-11-22",
  amount: 1250.5,
  methodId: "00000000-0000-4000-8000-000000000001",
  cashAccountId: "00000000-0000-4000-8000-000000000002",
  categoryId: "00000000-0000-4000-8000-000000000003",
  reference: "TX-0001",
});

// El mismo payload con importe 0: el schema lo rechaza y el API devolveria 400.
const INVALID_PAYMENT = paymentSchema.safeParse({
  direction: "EGRESO",
  paymentDate: "2026-11-22",
  amount: 0,
  methodId: "00000000-0000-4000-8000-000000000001",
  cashAccountId: "00000000-0000-4000-8000-000000000002",
  categoryId: "00000000-0000-4000-8000-000000000003",
});

const INVALID_PAYMENT_MESSAGE = INVALID_PAYMENT.success
  ? null
  : (INVALID_PAYMENT.error.issues[0]?.message ?? "sin mensaje");

/** Andamiaje que no viene del origen: lo que se agrego para que `apps/web` arranque. */
const SHELL_ITEMS: ReadonlyArray<{ path: string; description: string }> = [
  { path: "app/layout.tsx", description: "Layout raiz: fuentes, tokens de globals.css y el Toaster de sonner." },
  { path: "app/globals.css", description: "Entrada de Tailwind v4 con el tema del origen, verbatim." },
  { path: "hooks/use-mobile.ts", description: "Lo usa components/ui/sidebar.tsx; portado junto al kit." },
  { path: "lib/api/client.ts", description: "Cliente tipado de apps/api: /health, /payments y /contract/payments." },
  { path: "lib/auth/client.ts", description: "Cliente de Better Auth (better-auth/react) apuntando a /api/auth de apps/api." },
  { path: "lib/auth/session.ts", description: "Sesion del servidor: getSessionUser, signInWithEmail y signOutSession." },
  { path: "app/(app)/layout.tsx", description: "Shell autenticado: sin sesion redirige a /login antes de renderizar." },
  { path: "app/(app)/health/page.tsx", description: "Ruta que llama GET /health a traves del cliente, ya dentro del shell." },
];

/**
 * Landing minimo del shell. Muestra la sesion que resolvio el layout —la misma que usa el
 * navbar— para que el HTML servido pruebe de quien es la sesion, y conserva el inventario del
 * kit de UI de T5a, que es el contenido real con el que se ejercita el shell.
 */
export default async function HomePage() {
  const user = await getSessionUser();
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-3xl font-bold tracking-tight">Gestión</h1>
          <Badge>@gestion/web</Badge>
          <Badge variant="outline">T5b2 · shell</Badge>
          <Badge variant="secondary">sesión: {user?.email ?? "sin sesión"}</Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Frontend del monorepo: Next.js 16 (App Router), React 19 y Tailwind v4, con el kit de
          UI del proyecto de origen y un cliente tipado contra <code>apps/api</code>. Sin
          componentes de dominio todavía: eso es T5b.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Kit de UI portado</CardTitle>
          <CardDescription>
            {KIT_FILES.length} archivos y {KIT_TOTAL_LINES.toLocaleString("es-PE")} líneas desde{" "}
            <code>components/ui/</code>.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{KIT_FILES.length} archivos</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="tabla">
            <TabsList>
              <TabsTrigger value="tabla">Tabla</TabsTrigger>
              <TabsTrigger value="andamiaje">Andamiaje</TabsTrigger>
            </TabsList>
            <TabsContent value="tabla">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Archivo</TableHead>
                    <TableHead className="text-right">Líneas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {KIT_FILES.map((entry) => (
                    <TableRow key={entry.file}>
                      <TableCell className="font-mono text-xs">components/ui/{entry.file}</TableCell>
                      <TableCell className="text-right tabular-nums">{entry.lines}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="andamiaje">
              <ItemGroup>
                {SHELL_ITEMS.map((entry, index) => (
                  <div key={entry.path} className="flex flex-col">
                    {index > 0 ? <ItemSeparator /> : null}
                    <Item variant="muted">
                      <ItemContent>
                        <ItemTitle className="font-mono text-xs">{entry.path}</ItemTitle>
                        <ItemDescription>{entry.description}</ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Badge variant="outline">T5a</Badge>
                      </ItemActions>
                    </Item>
                  </div>
                ))}
              </ItemGroup>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Controles y tokens</CardTitle>
          <CardDescription>
            Botones, campos, separadores y formato de moneda salen del kit y de{" "}
            <code>@gestion/shared</code>, no de este paquete.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Primario</Button>
            <Button variant="secondary">Secundario</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="destructive">Destructivo</Button>
            <Button variant="link">Link</Button>
            <Button variant="ghost" size="sm" render={<Link href="/health" />}>
              Ver /health
            </Button>
          </div>

          <Separator />

          <FieldGroup className="sm:grid sm:grid-cols-2 sm:items-start">
            <Field>
              <FieldLabel htmlFor="monto">Monto de ejemplo</FieldLabel>
              <Input id="monto" readOnly value={formatCurrency(1250.5)} />
              <FieldDescription>
                <code>formatCurrency</code> viene de <code>@gestion/shared</code>.
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Checkbox defaultChecked id="incluir-caja" />
              <FieldContent>
                <FieldTitle>Mover caja</FieldTitle>
                <FieldDescription>Checkbox de Base UI, con estado local.</FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex items-center justify-between gap-4">
          <div className="flex w-full max-w-xs flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Badge variant="ghost">skeleton</Badge>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contrato compartido</CardTitle>
          <CardDescription>
            El schema Zod de pago viaja por nombre de paquete: el mismo contrato valida este
            frontend y el borde de apps/api.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup>
            <Item variant="outline">
              <ItemContent>
                <ItemTitle>
                  Pago válido <Badge variant="secondary">aceptado</Badge>
                </ItemTitle>
                <ItemDescription>
                  {VALID_PAYMENT.success
                    ? `importe ${formatCurrency(VALID_PAYMENT.data.amount)} · direction ${VALID_PAYMENT.data.direction} · asignaciones ${VALID_PAYMENT.data.allocations.length}`
                    : "el schema rechazó el payload de ejemplo"}
                </ItemDescription>
              </ItemContent>
            </Item>
            <ItemSeparator />
            <Item variant="outline">
              <ItemContent>
                <ItemTitle>
                  Importe 0 <Badge variant="destructive">rechazado</Badge>
                </ItemTitle>
                <ItemDescription>{INVALID_PAYMENT_MESSAGE}</ItemDescription>
              </ItemContent>
            </Item>
          </ItemGroup>
        </CardContent>
      </Card>
    </main>
  );
}
