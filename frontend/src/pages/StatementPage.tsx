// ── Credit Statement Matcher — embedded under /statement ──────────────────────
// The matcher is a standalone FastAPI + Jinja app that Nginx reverse-proxies at
// /statement/ (same origin, same TLS). We surface it inside the SPA shell via a
// same-origin iframe so it inherits the sidebar, domain, and login boundary.
//
// The matcher's own pages are reachable only under the proxied /statement/ path,
// so they can't be React Router routes. The sidebar submenu instead drives this
// single page via ?tab=, which we map to the matcher's native route below.
import { useSearchParams } from "react-router-dom";

const TAB_TO_PATH: Record<string, string> = {
  upload: "/statement/upload",
  transactions: "/statement/transactions",
  "manual-edit": "/statement/manual-edit",
  summary: "/statement/summary",
  cards: "/statement/cards",
};

export function StatementPage() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "upload";
  const src = TAB_TO_PATH[tab] ?? TAB_TO_PATH.upload;

  return (
    <div className="h-full w-full">
      <iframe
        key={src}
        src={src}
        title="ตรวจ Statement บัตรเครดิต"
        className="block h-full w-full border-0"
      />
    </div>
  );
}
