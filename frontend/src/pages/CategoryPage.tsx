import { useEffect, useState } from "react";
import { Plus, Loader2, Tag, Pencil, Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { categoriesApi } from "@/api/cashflow";
import type { CashflowCategory } from "@/api/cashflow";

const TYPE_LABELS: Record<string, string> = {
  income: "รายรับ", expense: "รายจ่าย", payable: "เจ้าหนี้", receivable: "ลูกหนี้",
};
const TYPE_COLORS: Record<string, string> = {
  income: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expense: "bg-rose-50 text-rose-700 border-rose-200",
  payable: "bg-amber-50 text-amber-700 border-amber-200",
  receivable: "bg-blue-50 text-blue-700 border-blue-200",
};

export function CategoryPage() {
  const [categories, setCategories] = useState<CashflowCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const cats = await categoriesApi.list();
      setCategories(cats);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (type: string) => {
    if (!newName.trim()) return;
    await categoriesApi.create({ type, name: newName.trim(), sort_order: 99 });
    setNewName(""); setAdding(null); load();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("ต้องการปิดการใช้งานหมวดหมู่นี้?")) return;
    await categoriesApi.delete(id); load();
  };

  const startEdit = (cat: CashflowCategory) => {
    setEditingId(cat.id);
    setEditName(cat.name);
  };

  const handleRename = async (id: number) => {
    if (!editName.trim()) return;
    await categoriesApi.update(id, { name: editName.trim() });
    setEditingId(null); setEditName(""); load();
  };

  const cancelEdit = () => { setEditingId(null); setEditName(""); };

  const byType = (type: string) => categories.filter(c => c.type === type);

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="หมวดหมู่บัญชี" subtitle="จัดการหมวดหมู่รายรับ รายจ่าย เจ้าหนี้ ลูกหนี้" />

      {loading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {["income", "expense", "payable", "receivable"].map(type => (
            <Card key={type}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium border ${TYPE_COLORS[type]}`}>
                      {TYPE_LABELS[type]}
                    </span>
                    <span className="text-muted-foreground text-xs font-normal">
                      {byType(type).length} หมวดหมู่
                    </span>
                  </CardTitle>
                  <button
                    onClick={() => setAdding(adding === type ? null : type)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <Plus className="h-3 w-3" /> เพิ่ม
                  </button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                {adding === type && (
                  <div className="flex gap-2 mb-3">
                    <input
                      className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="ชื่อหมวดหมู่ใหม่..."
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleAdd(type)}
                      autoFocus
                    />
                    <button onClick={() => handleAdd(type)}
                      className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
                      เพิ่ม
                    </button>
                    <button onClick={() => { setAdding(null); setNewName(""); }}
                      className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent">
                      ยกเลิก
                    </button>
                  </div>
                )}
                <div className="space-y-1.5">
                  {byType(type).map(cat => (
                    <div key={cat.id}
                      className="flex items-center justify-between rounded-lg border px-3 py-2 hover:bg-muted/30">
                      {editingId === cat.id ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <input
                            className="flex-1 rounded border border-input px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") handleRename(cat.id); if (e.key === "Escape") cancelEdit(); }}
                            autoFocus
                          />
                          <button onClick={() => handleRename(cat.id)}
                            className="text-emerald-600 hover:text-emerald-700">
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={cancelEdit}
                            className="text-muted-foreground hover:text-foreground">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm">{cat.name}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => startEdit(cat)}
                              className="text-muted-foreground hover:text-foreground p-1">
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button onClick={() => handleDelete(cat.id)}
                              className="text-[11px] text-muted-foreground hover:text-destructive">
                              ลบ
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                  {byType(type).length === 0 && (
                    <p className="text-sm text-center py-4 text-muted-foreground">ยังไม่มีหมวดหมู่</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
