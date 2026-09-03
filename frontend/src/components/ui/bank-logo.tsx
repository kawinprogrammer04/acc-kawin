import { Landmark } from "lucide-react";
import { getThaiBank } from "@/lib/banks";
import { cn } from "@/lib/utils";

type BankLogoProps = {
  bankName?: string | null;
  className?: string;
};

export function BankLogo({ bankName, className }: BankLogoProps) {
  const bank = getThaiBank(bankName);

  return <span
    className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white p-1 shadow-sm", className)}
    title={bank?.label || bankName || "ไม่ระบุธนาคาร"}
  >
    {bank
      ? <img src={bank.logoPath} alt="" aria-hidden="true" loading="lazy" className="h-full w-full object-contain" />
      : <Landmark aria-hidden="true" className="h-5 w-5 text-muted-foreground" />}
  </span>;
}
