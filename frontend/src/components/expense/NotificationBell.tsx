import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { expenseNotificationsApi, type ExpenseNotification } from "@/api/approvals";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function NotificationBell() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ExpenseNotification[]>([]);

  const refresh = () => expenseNotificationsApi.list().then(setItems).catch(() => undefined);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const unread = items.filter((item) => !item.read_at).length;
  const openItem = async (item: ExpenseNotification) => {
    if (!item.read_at) {
      await expenseNotificationsApi.markRead(item.id).catch(() => undefined);
      setItems((current) => current.map((row) => row.id === item.id
        ? { ...row, read_at: new Date().toISOString() }
        : row));
    }
    if (item.action_url) navigate(item.action_url);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" className="relative bg-background" aria-label="การแจ้งเตือน">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-destructive px-1 text-[10px] leading-4 text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="border-b px-4 py-3 text-sm font-semibold">การแจ้งเตือน</div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">ไม่มีการแจ้งเตือน</div>}
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => openItem(item)}
              className={cn("block w-full border-b px-4 py-3 text-left hover:bg-muted", !item.read_at && "bg-primary/5")}
            >
              <div className="text-sm font-medium">{item.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{item.message}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{new Date(item.created_at).toLocaleString("th-TH")}</div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
