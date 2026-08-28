import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { BookOpen, Loader2, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function LoginPage() {
  const { user, login, loginWithHrToken } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const [hrSsoToken] = useState(() => searchParams.get("token"));
  const [ssoLoading, setSsoLoading] = useState(() => Boolean(hrSsoToken));
  const [ssoAuthenticated, setSsoAuthenticated] = useState(false);
  const [ssoError, setSsoError] = useState("");

  useEffect(() => {
    if (!hrSsoToken) return;
    // Strip the token from the address bar immediately, before the exchange
    // even resolves — it must not linger in browser history/back-button
    // state whether the exchange succeeds or fails.
    window.history.replaceState({}, "", "/login");
    loginWithHrToken(hrSsoToken)
      .then(() => setSsoAuthenticated(true))
      .catch((e) => {
        const status = e?.response?.status;
        if (status === 401) {
          setSsoError("ลิงก์จาก HR หมดอายุ กรุณากดปุ่ม \"ระบบบัญชี\" จาก HR ใหม่");
        } else if (status === 403) {
          setSsoError(e?.response?.data?.detail || "ไม่มีสิทธิ์เข้าใช้งานระบบบัญชี กรุณาติดต่อผู้ดูแลระบบ");
        } else {
          setSsoError("เชื่อมต่อระบบ HR ไม่สำเร็จ กรุณาลองใหม่ หรือเข้าสู่ระบบด้วยรหัสผ่านแทน");
        }
      })
      .finally(() => setSsoLoading(false));
    // Runs once on mount only — intentionally not re-reading searchParams
    // after the replaceState() above clears it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (user && (!hrSsoToken || ssoAuthenticated)) {
    return <Navigate to={ssoAuthenticated ? "/expense-requests" : "/"} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
    } catch {
      setError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-slate-100 p-4">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <BookOpen className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">ระบบบัญชี SME</CardTitle>
          <CardDescription>กรุณาเข้าสู่ระบบเพื่อดำเนินการต่อ</CardDescription>
        </CardHeader>
        <CardContent>
          {ssoLoading ? (
            <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              กำลังเข้าสู่ระบบผ่าน HR...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {ssoError && <p className="text-sm text-destructive">{ssoError}</p>}
              <div className="space-y-1.5">
                <Label htmlFor="username">ชื่อผู้ใช้</Label>
                <Input
                  id="username" value={username} onChange={(e) => setUsername(e.target.value)}
                  placeholder="username" autoFocus required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">รหัสผ่าน</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="password"
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                เข้าสู่ระบบ
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
