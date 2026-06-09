import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, X, Eye, EyeOff, Loader2 } from "lucide-react";

interface Props {
  onClose: () => void;
}

export function ChangePasswordDialog({ onClose }: Props) {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (newPassword !== confirm) { setError("Passwords do not match"); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: newPassword });
      if (err) { setError(err.message); return; }
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-background border border-border rounded-xl shadow-2xl p-6 w-full max-w-sm text-foreground"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-indigo-400" />
            <h2 className="text-lg font-semibold">Change Password</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {success ? (
          <div className="py-6 text-center text-green-400 font-medium">✅ Password updated successfully!</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-foreground/80 text-sm">New Password</Label>
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="bg-card border-border text-foreground pr-10"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-foreground/80 text-sm">Confirm Password</Label>
              <Input
                type={show ? "text" : "password"}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repeat new password"
                className="bg-card border-border text-foreground"
              />
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-3 pt-1">
              <Button
                type="submit"
                disabled={loading}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update Password"}
              </Button>
              <Button type="button" variant="outline" onClick={onClose} className="border-border text-foreground/80">
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
