import { STATUS_LABEL, type InvoiceStatus } from "../lib/invoiceStatus.ts";

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return <span className={`badge badge--${status}`}>{STATUS_LABEL[status]}</span>;
}
