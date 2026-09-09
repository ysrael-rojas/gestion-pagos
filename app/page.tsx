import { AppContent, Badge, Card, SmallBox, Table } from "@adminlte/react";
import { kpis, recentPayments, type Payment, type PaymentStatus } from "@/lib/mock-data";

const statusLabels: Record<PaymentStatus, string> = {
  paid: "Pagado",
  pending: "Pendiente",
  overdue: "Vencido",
};

const amountFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
});

function StatusBadge({ status }: { status: PaymentStatus }) {
  switch (status) {
    case "paid":
      return <Badge theme="success">{statusLabels[status]}</Badge>;
    case "overdue":
      return <Badge theme="danger">{statusLabels[status]}</Badge>;
    case "pending":
      return <span className="text-muted">{statusLabels[status]}</span>;
  }
}

const columns = [
  { key: "id", header: "Factura" },
  { key: "customer", header: "Cliente" },
  {
    key: "amount",
    header: "Importe",
    render: (row: Payment) => amountFormatter.format(row.amount),
    align: "end" as const,
  },
  {
    key: "dueDate",
    header: "Vencimiento",
    render: (row: Payment) => new Date(`${row.dueDate}T00:00:00`).toLocaleDateString("es-ES"),
  },
  {
    key: "status",
    header: "Estado",
    render: (row: Payment) => <StatusBadge status={row.status} />,
  },
];

export default function Home() {
  return (
    <AppContent
      title="Dashboard"
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Dashboard" }]}
    >
      <div className="row g-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="col-12 col-sm-6 col-xl-4">
            <SmallBox title={kpi.value} text={kpi.label} />
          </div>
        ))}
      </div>

      <div className="row mt-4">
        <div className="col-12">
          <Card title="Pagos recientes">
            <Table
              columns={columns}
              data={recentPayments}
              rowKey={(row) => row.id}
              hover
              responsive
            />
          </Card>
        </div>
      </div>
    </AppContent>
  );
}
