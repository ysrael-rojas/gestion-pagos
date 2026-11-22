import { PaymentsCreateView } from "@/components/pagos/payments-create-view";

export default async function NuevoIngresoPage({
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
      direction="INGRESO"
      initialEntityId={entityId}
      initialComprobanteId={comprobanteId}
    />
  );
}
