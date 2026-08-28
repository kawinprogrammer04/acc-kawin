import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";

export function DataListKpiCard({
  label, value, tone, icon: Icon, currency = false,
}: {
  label: string;
  value: number;
  tone: string;
  icon: LucideIcon;
  currency?: boolean;
}) {
  return <Card className="overflow-hidden"><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm font-semibold text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-black">{currency ? formatCurrency(value) : value.toLocaleString("th-TH")}</p></div><div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tone}`}><Icon className="h-6 w-6" /></div></CardContent></Card>;
}
