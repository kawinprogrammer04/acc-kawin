export interface CompanyPresentationSource {
  code?: string;
  name_th: string;
}

const COMPANY_ICONS: Record<string, string> = {
  KAWIN_BROTHERS: "🌈",
  KAWIN_FULFILL: "🚚",
  KAWIN_CONSULT: "💎",
  GOOD_FERTILIZER: "🌴",
  HENGHENG_PANGPANG: "💰",
};

export function getCompanyIcon(company: Pick<CompanyPresentationSource, "code">): string | null {
  return company.code ? COMPANY_ICONS[company.code] ?? null : null;
}

export function formatCompanyLabel(company: CompanyPresentationSource): string {
  const icon = getCompanyIcon(company);
  return icon ? `${icon} ${company.name_th}` : company.name_th;
}
