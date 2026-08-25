import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, Clock3, DatabaseBackup, FileCheck2,
  Loader2, Play, RefreshCcw, ShieldCheck, XCircle,
} from "lucide-react";
import { hrSyncApi, type HrSyncConfiguration, type HrSyncJob } from "@/api/hrSync";
import { getApiErrorMessage } from "@/api/client";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";


const SOURCE_LABELS: Record<string, string> = {
  users: "ผู้ใช้",
  positions: "ตำแหน่ง",
  requests: "รายการเบิก",
  items: "รายการย่อย",
  attachments: "ไฟล์แนบ",
  approval_rows: "ข้อมูลผู้อนุมัติ",
};

const RESULT_LABELS: Record<string, string> = {
  users_create: "ผู้ใช้ใหม่",
  users_update_or_reuse: "ผู้ใช้ที่อัปเดต/ใช้เดิม",
  requests_create: "รายการเบิกใหม่",
  requests_update: "รายการเบิกที่อัปเดต",
  request_number_collisions: "เลขรายการชนกัน",
  files_validated: "ไฟล์ที่ตรวจสอบ",
  files_copied: "ไฟล์ที่คัดลอกใหม่",
  files_reused: "ไฟล์เดิมที่ใช้ซ้ำ",
};

const CHECK_LABELS: Record<keyof HrSyncConfiguration["checks"], string> = {
  database_configured: "ฐานข้อมูล HR แบบ read-only",
  storage_mounted: "โฟลเดอร์เอกสาร HR แบบ read-only",
  app_key_configured: "กุญแจถอดรหัส HR",
  backup_tool_available: "ระบบสำรองข้อมูล ACC",
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function StatusBadge({ job }: { job: HrSyncJob }) {
  const styles = {
    queued: "bg-amber-50 text-amber-700 border-amber-200",
    running: "bg-blue-50 text-blue-700 border-blue-200",
    succeeded: "bg-emerald-50 text-emerald-700 border-emerald-200",
    failed: "bg-rose-50 text-rose-700 border-rose-200",
  }[job.status];
  const labels = { queued: "รอเริ่ม", running: "กำลังทำงาน", succeeded: "สำเร็จ", failed: "ไม่สำเร็จ" };
  const Icon = job.status === "succeeded" ? CheckCircle2
    : job.status === "failed" ? XCircle
      : job.status === "running" ? Loader2 : Clock3;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${styles}`}>
      <Icon className={`h-3.5 w-3.5 ${job.status === "running" ? "animate-spin" : ""}`} />
      {labels[job.status]}
    </span>
  );
}

function CountGrid({ counts, labels }: { counts: Record<string, number>; labels: Record<string, string> }) {
  const rows = Object.entries(counts).filter(([key]) => labels[key]);
  if (!rows.length) return <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูลสรุป</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([key, value]) => (
        <div key={key} className="rounded-lg border bg-slate-50 px-3 py-2">
          <p className="text-xs text-muted-foreground">{labels[key]}</p>
          <p className="text-xl font-semibold tabular-nums">{Number(value).toLocaleString("th-TH")}</p>
        </div>
      ))}
    </div>
  );
}

export function HrSyncPage() {
  const { user } = useAuth();
  const [configuration, setConfiguration] = useState<HrSyncConfiguration | null>(null);
  const [jobs, setJobs] = useState<HrSyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<"preflight" | "apply" | null>(null);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [nextConfiguration, nextJobs] = await Promise.all([
        hrSyncApi.configuration(), hrSyncApi.jobs(),
      ]);
      setConfiguration(nextConfiguration);
      setJobs(nextJobs);
      setError("");
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "โหลดสถานะ HR Sync ไม่สำเร็จ"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const activeJob = jobs.find((job) => job.status === "queued" || job.status === "running");
  useEffect(() => {
    if (!activeJob) return;
    const timer = window.setInterval(() => { void refresh(true); }, 2000);
    return () => window.clearInterval(timer);
  }, [activeJob?.id, refresh]);

  const latestPreflight = useMemo(
    () => jobs.find((job) => job.mode === "preflight" && job.status === "succeeded"),
    [jobs],
  );
  const hasConflicts = Boolean(latestPreflight?.conflicts.length);

  if (!user?.is_platform_admin) return <Navigate to="/" replace />;

  async function startPreflight() {
    setStarting("preflight"); setError("");
    try {
      await hrSyncApi.preflight();
      await refresh(true);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "เริ่มตรวจสอบข้อมูลไม่สำเร็จ"));
    } finally { setStarting(null); }
  }

  async function startApply() {
    if (!latestPreflight) return;
    setStarting("apply"); setError("");
    try {
      await hrSyncApi.apply(latestPreflight.id);
      setConfirmOpen(false);
      await refresh(true);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, "เริ่มนำเข้าข้อมูลไม่สำเร็จ"));
    } finally { setStarting(null); }
  }

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="ซิงก์ข้อมูล HR"
        subtitle="ตรวจสอบและนำข้อมูลผู้ใช้ รายการเบิก เอกสาร และเส้นทางอนุมัติล่าสุดจาก HR เข้า ACC"
      >
        <Link to="/settings" className="text-sm text-muted-foreground hover:text-foreground">กลับหน้าตั้งค่า</Link>
      </PageHeader>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-primary" /> ความพร้อมของระบบ
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !configuration ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : configuration ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {(Object.keys(configuration.checks) as Array<keyof HrSyncConfiguration["checks"]>).map((key) => (
                  <div key={key} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    {configuration.checks[key]
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      : <XCircle className="h-4 w-4 text-rose-600" />}
                    {CHECK_LABELS[key]}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                อ่านรายการ HR ตั้งแต่ {configuration.from_date} เป็นต้นไป และ HR จะถูกเปิดอ่านอย่างเดียว
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">ขั้นตอนการซิงก์</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border p-4">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <FileCheck2 className="h-5 w-5 text-blue-600" /> 1. ตรวจสอบข้อมูล
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                อ่าน HR ตรวจไฟล์ เลขบัญชี และคำนวณรายการที่จะเพิ่มหรือแก้ไข โดยยังไม่เปลี่ยน ACC
              </p>
              <Button
                onClick={startPreflight}
                disabled={!configuration?.ready || Boolean(activeJob) || Boolean(starting)}
              >
                {starting === "preflight" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                ตรวจสอบข้อมูลล่าสุด
              </Button>
            </div>
            <div className="rounded-xl border p-4">
              <div className="mb-2 flex items-center gap-2 font-medium">
                <DatabaseBackup className="h-5 w-5 text-emerald-600" /> 2. สำรองและนำเข้า
              </div>
              <p className="mb-4 text-sm text-muted-foreground">
                สร้าง backup ACC ก่อน แล้วนำเข้าเฉพาะ snapshot ที่ผ่านการตรวจสอบล่าสุด
              </p>
              <Button
                variant="default"
                onClick={() => setConfirmOpen(true)}
                disabled={!configuration?.ready || !latestPreflight || hasConflicts || Boolean(activeJob) || Boolean(starting)}
              >
                <Play className="mr-2 h-4 w-4" /> ยืนยันนำเข้าข้อมูล
              </Button>
            </div>
          </div>
          {activeJob && (
            <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <Loader2 className="h-5 w-5 animate-spin" />
              {activeJob.mode === "preflight" ? "กำลังตรวจสอบข้อมูล HR" : "กำลังสำรองและนำเข้าข้อมูล"}
              <span className="ml-auto text-xs">ปิดหน้านี้ได้ งานจะทำต่อในระบบ</span>
            </div>
          )}
        </CardContent>
      </Card>

      {latestPreflight && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ผลตรวจสอบล่าสุด</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasConflicts && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" />
                  พบเลขรายการชนกัน {latestPreflight.conflicts.length.toLocaleString("th-TH")} รายการ — ระบบปิดการนำเข้าไว้
                </div>
                <p className="mb-3 text-xs">
                  รายการเหล่านี้มีอยู่ใน ACC แต่ไม่ได้เชื่อมกับรายการ HR เดียวกัน ระบบจะไม่ลบ รวม หรือเปลี่ยนเลขให้อัตโนมัติ
                </p>
                <div className="space-y-2">
                  {latestPreflight.conflicts.map((conflict) => (
                    <div key={`${conflict.request_no}:${conflict.acc_expense_request_id}`} className="rounded-md border border-rose-200 bg-white px-3 py-2">
                      <p className="font-mono font-semibold">{conflict.request_no}</p>
                      <p className="text-xs">HR: {conflict.hr_title}</p>
                      <p className="text-xs">ACC: {conflict.acc_title} · {conflict.acc_status}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-2 text-sm font-medium">ข้อมูลต้นทาง</p>
              <CountGrid counts={latestPreflight.source_counts} labels={SOURCE_LABELS} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">แผนการนำเข้า</p>
              <CountGrid counts={latestPreflight.result_counts} labels={RESULT_LABELS} />
            </div>
            <p className="text-xs text-muted-foreground">
              ตรวจเมื่อ {formatDate(latestPreflight.completed_at)} · Snapshot {latestPreflight.source_snapshot_sha256?.slice(0, 12)}…
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">ประวัติการทำงาน</CardTitle>
          <Button variant="outline" size="sm" onClick={() => void refresh(true)} disabled={loading}>
            <RefreshCcw className="mr-2 h-4 w-4" /> รีเฟรช
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3">เวลา</th><th className="py-2 pr-3">งาน</th>
                <th className="py-2 pr-3">สถานะ</th><th className="py-2 pr-3">ผู้สั่ง</th>
                <th className="py-2">รายละเอียด</th>
              </tr></thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-b align-top last:border-0">
                    <td className="whitespace-nowrap py-3 pr-3">{formatDate(job.created_at)}</td>
                    <td className="py-3 pr-3">{job.mode === "preflight" ? "ตรวจสอบ" : "นำเข้า"}</td>
                    <td className="py-3 pr-3"><StatusBadge job={job} /></td>
                    <td className="py-3 pr-3">{job.requested_by_username}</td>
                    <td className="py-3">
                      {job.error_message ? <span className="text-rose-700">{job.error_message}</span>
                        : job.backup_file_name ? <span className="text-muted-foreground">Backup: {job.backup_file_name}</span>
                          : job.status === "succeeded" ? <span className="text-emerald-700">ดำเนินการครบถ้วน</span> : "-"}
                    </td>
                  </tr>
                ))}
                {!jobs.length && !loading && (
                  <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">ยังไม่มีประวัติการซิงก์</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={(open) => !starting && setConfirmOpen(open)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" /> ยืนยันนำเข้าข้อมูล HR
            </DialogTitle>
            <DialogDescription>
              ระบบจะตรวจว่า HR ยังตรงกับ snapshot ล่าสุด สร้าง backup ACC แล้วจึงเริ่มนำเข้า
              หาก HR เปลี่ยนหลังการตรวจสอบ ระบบจะหยุดและให้ตรวจสอบใหม่
            </DialogDescription>
          </DialogHeader>
          {latestPreflight && (
            <div className="mx-6 rounded-lg border bg-slate-50 p-3 text-sm">
              รายการใหม่ {latestPreflight.result_counts.requests_create ?? 0} รายการ ·
              อัปเดต {latestPreflight.result_counts.requests_update ?? 0} รายการ
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={Boolean(starting)}>ยกเลิก</Button>
            <Button onClick={startApply} disabled={Boolean(starting) || hasConflicts}>
              {starting === "apply" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              สำรองและนำเข้า
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
