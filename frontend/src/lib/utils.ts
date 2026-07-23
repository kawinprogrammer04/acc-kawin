import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function formatDate(d: string | Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric", month: "short", day: "numeric",
    calendar: "buddhist",
  }).format(new Date(d));
}

export function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}
