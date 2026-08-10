export function formatCurrency(amount: number | string | undefined): string {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
  }).format(n);
}

export function formatNumber(n: number | string | undefined): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0));
}

export function formatDate(d: string | Date | undefined): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
}

export function today(): string {
  return localDateInput(new Date());
}

export function monthStart(): string {
  const d = new Date();
  return localDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function localDateInput(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
}

export const STATUS_COLORS: Record<string, string> = {
  pending: "text-yellow-600 bg-yellow-50",
  completed: "text-emerald-600 bg-emerald-50",
  cancelled: "text-gray-500 bg-gray-100",
  unpaid: "text-red-600 bg-red-50",
  partial: "text-orange-600 bg-orange-50",
  paid: "text-emerald-600 bg-emerald-50",
  overdue: "text-red-700 bg-red-100",
  unreceived: "text-red-600 bg-red-50",
  received: "text-emerald-600 bg-emerald-50",
};

export const STATUS_LABELS: Record<string, string> = {
  pending: "รอดำเนินการ",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
  unpaid: "ยังไม่จ่าย",
  partial: "จ่ายบางส่วน",
  paid: "จ่ายครบ",
  overdue: "เลยกำหนด",
  unreceived: "ยังไม่รับ",
  received: "รับครบ",
};

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  bank: "ธนาคาร",
  cash: "เงินสด",
  ewallet: "e-Wallet",
  credit_card: "บัตรเครดิต",
  other: "อื่นๆ",
};

export const HOLDER_TYPE_LABELS: Record<string, string> = {
  company: "เงินบริษัท",
  personal: "เงินส่วนตัว",
  tax: "เงินภาษี",
  salary: "เงินเดือน",
  project: "เงินโปรเจกต์",
  reserve: "เงินสำรอง",
  stock: "เงินสต็อก",
  other: "อื่นๆ",
};

export const OWNER_TYPE_LABELS: Record<string, string> = {
  company: "บริษัท",
  personal: "ส่วนตัว",
  mixed: "ผสม",
};
