// ── Credit Statement Matcher — embedded under /statement ──────────────────────
// The matcher is a standalone FastAPI + Jinja app that Nginx reverse-proxies at
// /statement/ (same origin, same TLS). We surface it inside the SPA shell via a
// same-origin iframe so it inherits the sidebar, domain, and login boundary.
//
// The matcher's own pages are reachable only under the proxied /statement/ path,
// so they can't be React Router routes. The sidebar submenu instead drives this
// single page via ?tab=, which we map to the matcher's native route below.
import { useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";

const TAB_TO_PATH: Record<string, string> = {
  review: "/statement/review",
  upload: "/statement/upload",
  references: "/statement/references",
  transactions: "/statement/transactions",
  "manual-edit": "/statement/manual-edit",
  summary: "/statement/summary",
  audit: "/statement/audit",
  cards: "/statement/cards",
};

export function StatementPage() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "review";
  const src = TAB_TO_PATH[tab] ?? TAB_TO_PATH.review;
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setFailed(false);
  }, [src]);

  return (
    <div className="relative h-screen min-h-[640px] w-full bg-background">
      {loading && !failed && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-background">
          <div className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
            กำลังเปิดหน้าตรวจ Statement...
          </div>
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-background p-6">
          <div className="max-w-md rounded-md border bg-card p-5 text-center shadow-sm">
            <h2 className="text-base font-semibold">เปิดระบบตรวจ Statement ไม่สำเร็จ</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              กรุณาตรวจสอบว่า service statement ทำงานอยู่ แล้วลองเปิดหน้านี้อีกครั้ง
            </p>
            <button
              type="button"
              className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => {
                setFailed(false);
                setLoading(true);
                setReloadKey((value) => value + 1);
              }}
            >
              ลองใหม่
            </button>
          </div>
        </div>
      )}
      <iframe
        key={`${src}:${reloadKey}`}
        src={src}
        title="ตรวจ Statement บัตรเครดิต"
        className="absolute inset-0 block h-full w-full border-0"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
      />
    </div>
  );
}
