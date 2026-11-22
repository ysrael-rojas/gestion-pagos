import { PaymentsCreateView } from "@/components/pagos/payments-create-view";

export default async function NuevoEgresoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const entityId =
    typeof params.entityId === "string" ? params.entityId : undefined;
  const comprobanteId =
    typeof params.comprobanteId === "string" ? params.comprobanteId : undefined;

  return (
    <PaymentsCreateView
      direction="EGRESO"
      initialEntityId={entityId}
      initialComprobanteId={comprobanteId}
    />
  );
}
