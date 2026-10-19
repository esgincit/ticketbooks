"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookText } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/api/auth/login", { method: "POST", json: { email, password } });
      const next = new URLSearchParams(window.location.search).get("next") ?? "/dashboard";
      // Same-site paths only (blocks open redirects like //evil.com)
      const safeNext = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
      // API targets (e.g. OAuth authorize for AI tools) need a full page load
      if (safeNext.startsWith("/api/")) return window.location.assign(safeNext);
      router.push(safeNext);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to sign in. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="hidden flex-1 flex-col justify-between bg-[hsl(var(--sidebar))] p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary"><BookText className="h-5 w-5" /></span>
          <span className="text-lg font-semibold tracking-tight">TicketBooks</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl font-bold leading-tight">Work that moves.<br />Teams that ship.</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/60">
            Assign, track and complete work across your organization - tickets, boards,
            backlogs, reports and notifications in one place.
          </p>
          <ul className="mt-8 space-y-2.5 text-sm text-white/70">
            <li>&bull; Kanban board with realtime status updates</li>
            <li>&bull; Claim unassigned work from the Available Work queue</li>
            <li>&bull; Full audit trail on every ticket change</li>
          </ul>
        </div>
        <p className="text-xs text-white/40">&copy; {new Date().getFullYear()} TicketBooks</p>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm" aria-label="Sign in">
          <div className="mb-8 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary"><BookText className="h-5 w-5 text-white" /></span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">Sign in to TicketBooks</h1>
          <p className="mt-1 text-sm text-muted-foreground">Enter your work account credentials.</p>

          <div className="mt-7 space-y-4">
            <div>
              <Label htmlFor="email" required>Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus />
            </div>
            <div>
              <Label htmlFor="password" required>Password</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" />
            </div>
          </div>

          {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</p>}

          <Button type="submit" size="lg" loading={loading} className="mt-6 w-full justify-center">Sign in</Button>

          <div className="mt-4 flex justify-between text-xs">
            <Link href="/forgot-password" className="font-medium text-primary hover:underline">Forgot password?</Link>
          </div>

          <div className="mt-8 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Demo accounts (password: Password123!)</p>
            <p>admin@strike.io &middot; meera@strike.io &middot; rahul@strike.io</p>
          </div>
        </form>
      </div>
    </div>
  );
}
