export type PaymentStatus = "paid" | "pending" | "overdue";

export interface Payment {
  id: string;
  customer: string;
  amount: number;
  currency: "EUR";
  dueDate: string;
  status: PaymentStatus;
}

export interface Kpi {
  label: string;
  value: string;
}

export const kpis: Kpi[] = [
  { label: "Ingresos del mes", value: "€ 48.250,00" },
  { label: "Pagos pendientes", value: "€ 12.480,00" },
  { label: "Pagos vencidos", value: "€ 3.915,00" },
];

export const recentPayments: Payment[] = [
  {
    id: "INV-2026-001",
    customer: "Aurora Martínez",
    amount: 1250.0,
    currency: "EUR",
    dueDate: "2026-08-21",
    status: "paid",
  },
  {
    id: "INV-2026-002",
    customer: "InnovaSoft SL",
    amount: 4800.0,
    currency: "EUR",
    dueDate: "2026-09-01",
    status: "pending",
  },
  {
    id: "INV-2026-003",
    customer: "Talleres Castilla",
    amount: 760.5,
    currency: "EUR",
    dueDate: "2026-08-10",
    status: "overdue",
  },
  {
    id: "INV-2026-004",
    customer: "Clínica Dávila",
    amount: 2300.0,
    currency: "EUR",
    dueDate: "2026-09-05",
    status: "paid",
  },
  {
    id: "INV-2026-005",
    customer: "Grupo Nórdico SA",
    amount: 950.25,
    currency: "EUR",
    dueDate: "2026-08-28",
    status: "pending",
  },
];
