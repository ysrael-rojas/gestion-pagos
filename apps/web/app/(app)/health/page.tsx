import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { API_BASE_URL, getHealth, type HealthResponse } from "@/lib/api/client";

// La ruta prueba el cableado contra apps/api, no cachea: cada request pega de verdad.
export const dynamic = "force-dynamic";

export default async function HealthPage() {
  let health: HealthResponse | null = null;
  let error: string | null = null;

  try {
    health = await getHealth();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-bold tracking-tight">Estado del API</h1>
          {health ? <Badge>conectado</Badge> : <Badge variant="destructive">sin conexión</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          <code>GET /health</code> de <code>apps/api</code>, a través de <code>lib/api/client.ts</code>.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{health ? "El API respondió" : "El API no respondió"}</CardTitle>
          <CardDescription className="font-mono text-xs">{API_BASE_URL}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {health ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="health-status">status</FieldLabel>
                <Input id="health-status" readOnly value={health.status} />
              </Field>
              <Field>
                <FieldLabel htmlFor="health-service">service</FieldLabel>
                <Input id="health-service" readOnly value={health.service} />
              </Field>
              <Field>
                <FieldLabel htmlFor="health-timestamp">timestamp</FieldLabel>
                <Input id="health-timestamp" readOnly value={health.timestamp} />
              </Field>
            </FieldGroup>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                El cliente lanzó <code>ApiError</code>. La página se renderiza igual: sin API no hay
                estado, pero el shell y el kit siguen funcionando.
              </p>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{error}</pre>
              <p className="text-sm text-muted-foreground">
                Levantá el backend con{" "}
                <code>corepack pnpm --filter @gestion/api dev</code> y recargá.
              </p>
            </div>
          )}
          <Button variant="outline" size="sm" render={<Link href="/" />}>
            Volver al inicio
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
