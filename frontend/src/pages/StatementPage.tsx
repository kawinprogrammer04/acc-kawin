import { useSearchParams } from "react-router-dom";
import { UploadTab } from "./statement/UploadTab";
import { ReviewTab } from "./statement/ReviewTab";
import { TransactionsTab } from "./statement/TransactionsTab";
import { ManualEditTab } from "./statement/ManualEditTab";
import { ReferencesTab } from "./statement/ReferencesTab";
import { SummaryTab } from "./statement/SummaryTab";
import { AuditTab } from "./statement/AuditTab";
import { CardsTab } from "./statement/CardsTab";

// Statement matcher — queries credit_statement_matcher's own JSON API
// (see api/statement.ts) directly instead of embedding its Jinja pages in an
// iframe. The tab set/URL convention (?tab=...) matches Sidebar.tsx's
// statementNav and App.tsx's menuKeyByTab, which gate each tab by permission.
type StatementTab =
  | "upload" | "review" | "transactions" | "manual-edit"
  | "references" | "summary" | "audit" | "cards";

const TABS: Record<StatementTab, React.ComponentType> = {
  upload: UploadTab,
  review: ReviewTab,
  transactions: TransactionsTab,
  "manual-edit": ManualEditTab,
  references: ReferencesTab,
  summary: SummaryTab,
  audit: AuditTab,
  cards: CardsTab,
};

export function StatementPage() {
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("tab") ?? "upload";
  const tab = (requested in TABS ? requested : "upload") as StatementTab;
  const Tab = TABS[tab];
  return <Tab />;
}
