import { useEffect, useState, useCallback, useRef } from "react";
import { Loader2, FileText, Upload, Search, Download, Eye, Trash2, Image, File } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { api } from "@/api/client";

interface Document {
  id: number;
  reference_type: string;
  reference_id?: string;
  file_name: string;
  file_path: string;
  file_size?: number;
  mime_type?: string;
  uploaded_by?: number;
  uploaded_by_name?: string;
  created_at: string;
}

const REF_TYPE_LABELS: Record<string, string> = {
  income: "รายรับ",
  expense: "รายจ่าย",
  payable: "เจ้าหนี้",
  receivable: "ลูกหนี้",
  transfer: "โอนเงิน",
  journal: "สมุดรายวัน",
  other: "อื่นๆ",
};

function formatSize(bytes?: number) {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ mime }: { mime?: string }) {
  if (!mime) return <File className="h-5 w-5 text-muted-foreground" />;
  if (mime.startsWith("image/")) return <Image className="h-5 w-5 text-blue-500" />;
  if (mime === "application/pdf") return <FileText className="h-5 w-5 text-rose-500" />;
  return <File className="h-5 w-5 text-muted-foreground" />;
}

export function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [refType, setRefType] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadRef, setUploadRef] = useState({ type: "other", id: "" });
  const [showUpload, setShowUpload] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/documents", { params: { limit: 200 } });
      setDocs(res.data);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = docs.filter(d => {
    const kw = keyword.toLowerCase();
    const matchKw = !kw || d.file_name.toLowerCase().includes(kw) ||
      d.reference_type?.toLowerCase().includes(kw) ||
      d.uploaded_by_name?.toLowerCase().includes(kw);
    const matchType = !refType || d.reference_type === refType;
    return matchKw && matchType;
  });

  async function handleUpload() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", files[0]);
      formData.append("reference_type", uploadRef.type);
      if (uploadRef.id) formData.append("reference_id", uploadRef.id);
      await api.post("/documents/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setShowUpload(false);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (e: any) {
      alert(e.response?.data?.detail ?? "อัปโหลดไม่สำเร็จ");
    } finally { setUploading(false); }
  }

  function openFile(doc: Document) {
    const url = `/api/documents/${doc.id}/download`;
    window.open(url, "_blank");
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="เอกสาร" subtitle="จัดการไฟล์แนบ สลิป ใบเสร็จ และเอกสารทั้งหมด">
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Upload className="h-4 w-4" /> อัปโหลดเอกสาร
        </button>
      </PageHeader>

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold mb-4">อัปโหลดเอกสาร</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">ประเภทเอกสาร</label>
                <select
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={uploadRef.type}
                  onChange={e => setUploadRef(r => ({ ...r, type: e.target.value }))}
                >
                  {Object.entries(REF_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Reference ID (ถ้ามี)</label>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={uploadRef.id}
                  onChange={e => setUploadRef(r => ({ ...r, id: e.target.value }))}
                  placeholder="เช่น 123"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">เลือกไฟล์</label>
                <input
                  ref={fileRef}
                  type="file"
                  className="mt-1 w-full text-sm"
                  accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.xlsx,.docx"
                />
                <p className="text-[10px] text-muted-foreground mt-1">PDF, PNG, JPG, XLSX, DOCX — ขนาดสูงสุด 20 MB</p>
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setShowUpload(false)} className="rounded-lg border px-4 py-2 text-sm hover:bg-muted">ยกเลิก</button>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                อัปโหลด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">ประเภท</p>
              <select
                className="rounded-md border px-3 py-1.5 text-sm"
                value={refType}
                onChange={e => setRefType(e.target.value)}
              >
                <option value="">ทั้งหมด</option>
                {Object.entries(REF_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                placeholder="ค้นหาชื่อไฟล์..."
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                className="outline-none text-sm bg-transparent w-40"
              />
            </div>
            <span className="text-xs text-muted-foreground ml-auto">{filtered.length} รายการ</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FileText className="h-10 w-10 mb-2" />
              <p>ยังไม่มีเอกสาร</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr>
                    {["ไฟล์", "ประเภท", "Reference ID", "ขนาด", "อัปโหลดโดย", "วันที่", ""].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map(doc => (
                    <tr key={doc.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <FileIcon mime={doc.mime_type} />
                          <span className="text-xs max-w-[200px] truncate">{doc.file_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {REF_TYPE_LABELS[doc.reference_type] || doc.reference_type}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{doc.reference_id || "-"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{formatSize(doc.file_size)}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{doc.uploaded_by_name || "-"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(doc.created_at).toLocaleDateString("th-TH", { dateStyle: "short" })}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openFile(doc)}
                            className="rounded p-1.5 hover:bg-muted"
                            title="เปิดไฟล์"
                          >
                            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <a
                            href={`/api/documents/${doc.id}/download`}
                            download={doc.file_name}
                            className="rounded p-1.5 hover:bg-muted inline-flex"
                            title="ดาวน์โหลด"
                          >
                            <Download className="h-3.5 w-3.5 text-muted-foreground" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
