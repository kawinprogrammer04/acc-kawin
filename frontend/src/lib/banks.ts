export type BankProfile = {
  code: string;
  label: string;
  logoPath: string;
  aliases: string[];
};

export const THAI_BANKS: BankProfile[] = [
  { code: "BBL", label: "ธนาคารกรุงเทพ (BBL)", logoPath: "/bank-logos/BBL.png", aliases: ["ธนาคารกรุงเทพ", "กรุงเทพ", "bangkok bank", "bbl"] },
  { code: "KBANK", label: "ธนาคารกสิกรไทย (KBank)", logoPath: "/bank-logos/KBANK.png", aliases: ["ธนาคารกสิกรไทย", "กสิกรไทย", "kasikorn", "kbank"] },
  { code: "KTB", label: "ธนาคารกรุงไทย (KTB)", logoPath: "/bank-logos/KTB.png", aliases: ["ธนาคารกรุงไทย", "กรุงไทย", "krungthai", "ktb"] },
  { code: "SCB", label: "ธนาคารไทยพาณิชย์ (SCB)", logoPath: "/bank-logos/SCB.png", aliases: ["ธนาคารไทยพาณิชย์", "ไทยพาณิชย์", "siam commercial", "scb"] },
  { code: "BAY", label: "ธนาคารกรุงศรีอยุธยา (Krungsri)", logoPath: "/bank-logos/BAY.png", aliases: ["ธนาคารกรุงศรีอยุธยา", "กรุงศรีอยุธยา", "กรุงศรี", "krungsri", "bay"] },
  { code: "TTB", label: "ธนาคารทหารไทยธนชาต (ttb)", logoPath: "/bank-logos/TTB.png", aliases: ["ธนาคารทหารไทยธนชาต", "ทหารไทยธนชาต", "ทีเอ็มบีธนชาต", "ttb", "tmb"] },
  { code: "KKP", label: "ธนาคารเกียรตินาคินภัทร (KKP)", logoPath: "/bank-logos/KKP.png", aliases: ["ธนาคารเกียรตินาคินภัทร", "เกียรตินาคินภัทร", "เกียรตินาคิน", "kkp"] },
  { code: "CIMB", label: "ธนาคารซีไอเอ็มบี ไทย (CIMB)", logoPath: "/bank-logos/CIMB.png", aliases: ["ธนาคารซีไอเอ็มบี ไทย", "ธนาคารซีไอเอ็มบี", "ซีไอเอ็มบี", "cimb"] },
  { code: "TISCO", label: "ธนาคารทิสโก้ (TISCO)", logoPath: "/bank-logos/TISCO.png", aliases: ["ธนาคารทิสโก้", "ทิสโก้", "tisco"] },
  { code: "UOB", label: "ธนาคารยูโอบี (UOB)", logoPath: "/bank-logos/UOB.png", aliases: ["ธนาคารยูโอบี", "ยูโอบี", "united overseas", "uob"] },
  { code: "GSB", label: "ธนาคารออมสิน (GSB)", logoPath: "/bank-logos/GSB.png", aliases: ["ธนาคารออมสิน", "ออมสิน", "government savings", "gsb"] },
  { code: "GHB", label: "ธนาคารอาคารสงเคราะห์ (GHB)", logoPath: "/bank-logos/GHB.png", aliases: ["ธนาคารอาคารสงเคราะห์", "ธ.อ.ส.", "อาคารสงเคราะห์", "ghb"] },
  { code: "BAAC", label: "ธ.ก.ส. (BAAC)", logoPath: "/bank-logos/BAAC.png", aliases: ["ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร", "ธ.ก.ส.", "ธกส", "baac"] },
  { code: "IBANK", label: "ธนาคารอิสลามแห่งประเทศไทย (iBank)", logoPath: "/bank-logos/IBANK.png", aliases: ["ธนาคารอิสลามแห่งประเทศไทย", "อิสลามแห่งประเทศไทย", "islamic bank", "ibank"] },
];

export const THAI_BANK_OPTIONS = THAI_BANKS.map(bank => bank.label);

function normalizeBankName(value: string): string {
  return value.toLocaleLowerCase("th-TH").replace(/[\s().,&-]+/g, "");
}

export function getThaiBank(bankName?: string | null): BankProfile | undefined {
  if (!bankName?.trim()) return undefined;
  const normalized = normalizeBankName(bankName);
  return THAI_BANKS.find(bank =>
    normalizeBankName(bank.label) === normalized
    || bank.aliases.some(alias => normalized.includes(normalizeBankName(alias))),
  );
}
