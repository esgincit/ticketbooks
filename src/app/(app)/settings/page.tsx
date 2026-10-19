"use client";

import { useEffect, useState } from "react";
import { UserCog, Building2, Mail, ShieldCheck, Send, Timer, Bot } from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { Input, Select, Label, Skeleton } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useTheme, useToast } from "@/components/providers";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "account", label: "Account", icon: UserCog },
  { key: "organization", label: "Organization", icon: Building2 },
  { key: "sla", label: "SLA", icon: Timer, perm: "settings.manage" },
  { key: "email", label: "Email", icon: Mail, perm: "settings.manage" },
  { key: "security", label: "Security", icon: ShieldCheck },
  { key: "ai", label: "AI tools", icon: Bot },
] as const;

export default function SettingsPage() {
  const [me, setMe] = useState<{ id: string; permissions: string[]; email: string; firstName: string; lastName: string; jobTitle?: string | null; phone?: string | null; timeZone?: string | null; teamName?: string | null; roleName?: string } | null>(null);
  const [tab, setTab] = useState<string>("account");

  useEffect(() => {
    api<{ user: NonNullable<typeof me> }>("/api/auth/me").then((d) => setMe(d.user)).catch(() => {});
  }, []);

  if (!me) return <Skeleton className="h-96" />;
  const canManageSettings = me.permissions.includes("*") || me.permissions.includes("settings.manage");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <h1 className="text-lg font-bold tracking-tight">Settings</h1>

      <div role="tablist" className="flex flex-wrap gap-1 rounded-xl border bg-card p-1">
        {TABS.filter((t) => !("perm" in t) || canManageSettings).map(({ key, label, icon: Icon }) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={cn("flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors",
              tab === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === "account" && <AccountTab me={me} />}
      {tab === "organization" && <OrgTab canEdit={canManageSettings} />}
      {tab === "sla" && <SlaTab />}
      {tab === "email" && <EmailTab />}
      {tab === "security" && <SecurityTab />}
      {tab === "ai" && <AiToolsTab />}
    </div>
  );
}

function AccountTab({ me }: { me: { firstName: string; lastName: string; jobTitle?: string | null; phone?: string | null; timeZone?: string | null; teamName?: string | null; roleName?: string; email?: string } }) {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const [form, setForm] = useState({ firstName: me.firstName, lastName: me.lastName, jobTitle: me.jobTitle ?? "", phone: me.phone ?? "", timeZone: me.timeZone ?? "" });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);

  const saveProfile = async () => {
    setBusy(true);
    try {
      await api("/api/auth/me", { method: "PATCH", json: form });
      toast({ title: "Profile updated", variant: "success" });
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : "Failed", variant: "error" });
    } finally { setBusy(false); }
  };

  const changePw = async () => {
    if (pw.newPassword !== pw.confirm) return toast({ title: "New passwords do not match", variant: "error" });
    setBusy(true);
    try {
      await api("/api/auth/change-password", { method: "POST", json: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      toast({ title: "Password changed", variant: "success" });
      setPw({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : "Failed", variant: "error" });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold">Profile</h2>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <div><Label>First name</Label><Input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} /></div>
          <div><Label>Last name</Label><Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} /></div>
          <div><Label>Email</Label><Input value={me.email ?? ""} disabled /></div>
          <div><Label>Role</Label><Input value={me.roleName ?? ""} disabled /></div>
          <div><Label>Job title</Label><Input value={form.jobTitle} onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))} /></div>
          <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
          <div className="sm:col-span-2"><Label>Time zone</Label><Input value={form.timeZone} onChange={(e) => setForm((f) => ({ ...f, timeZone: e.target.value }))} /></div>
        </div>
        <div className="mt-4 flex justify-end"><Button loading={busy} onClick={() => void saveProfile()}>Save profile</Button></div>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold">Change password</h2>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <div><Label required>Current password</Label><Input type="password" value={pw.currentPassword} onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))} /></div>
          <div />
          <div><Label required>New password</Label><Input type="password" value={pw.newPassword} onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))} /></div>
          <div><Label required>Confirm new password</Label><Input type="password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} /></div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" disabled={!pw.currentPassword || pw.newPassword.length < 8} loading={busy} onClick={() => void changePw()}>Change password</Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold">Appearance &amp; notifications</h2>
        <div className="flex flex-wrap items-center gap-6">
          <div className="w-44">
            <Label>Theme</Label>
            <Select value={theme} onChange={(e) => setTheme(e.target.value as never)}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 pt-4 text-xs">
            <input type="checkbox" defaultChecked className="accent-primary" /> In-app notifications
          </label>
          <label className="flex items-center gap-2 pt-4 text-xs">
            <input type="checkbox" defaultChecked className="accent-primary" /> Email notifications for assignments and mentions
          </label>
        </div>
      </section>
    </div>
  );
}

function OrgTab({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [org, setOrg] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    api<{ organization?: Record<string, unknown> }>("/api/settings").then((d) => setOrg(d.organization ?? {})).catch(() => setOrg({}));
  }, []);

  const save = async () => {
    try {
      await api("/api/settings", { method: "PATCH", json: { key: "organization", value: org } });
      toast({ title: "Organization settings saved", variant: "success" });
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : "Failed", variant: "error" });
    }
  };

  if (!org) return <Skeleton className="h-64" />;
  return (
    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold">Organization details</h2>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <div><Label>Organization name</Label><Input disabled={!canEdit} value={String(org.name ?? "")} onChange={(e) => setOrg({ ...org, name: e.target.value })} /></div>
        <div><Label>Domain</Label><Input disabled={!canEdit} value={String(org.domain ?? "")} onChange={(e) => setOrg({ ...org, domain: e.target.value })} /></div>
        <div><Label>Support email</Label><Input disabled={!canEdit} value={String(org.supportEmail ?? "")} onChange={(e) => setOrg({ ...org, supportEmail: e.target.value })} /></div>
        <div>
          <Label>Inbound email project key</Label>
          <Input disabled={!canEdit} value={String(org.supportProjectKey ?? "")} placeholder="OPS"
            onChange={(e) => setOrg({ ...org, supportProjectKey: e.target.value.toUpperCase() })} />
          <p className="mt-1 text-[10px] text-muted-foreground">Emails to your support inbox become tickets in this project.</p>
        </div>
      </div>
      {canEdit && <div className="mt-4 flex justify-end"><Button onClick={() => void save()}>Save organization</Button></div>}
    </section>
  );
}

type SlaPolicyUi = {
  enabled: boolean;
  riskHours: number;
  defaultHours: number | null;
  byPriority: Record<string, number>;
};

function SlaTab() {
  const { toast } = useToast();
  const [policy, setPolicy] = useState<SlaPolicyUi | null>(null);
  const [priorities, setPriorities] = useState<{ id: string; name: string; color: string; order: number }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ sla?: SlaPolicyUi }>("/api/settings").then((d) => {
      const p = d.sla;
      setPolicy({
        enabled: p?.enabled !== false,
        riskHours: Number(p?.riskHours ?? 24),
        defaultHours: p?.defaultHours != null ? Number(p.defaultHours) : null,
        byPriority: p?.byPriority ?? {},
      });
    }).catch(() => setPolicy({ enabled: true, riskHours: 24, defaultHours: null, byPriority: {} }));
    api<{ priorities: typeof priorities }>("/api/meta").then((m) => setPriorities([...m.priorities].sort((a, b) => b.order - a.order))).catch(() => {});
  }, []);

  if (!policy) return <Skeleton className="h-80" />;

  const set = (patch: Partial<SlaPolicyUi>) => setPolicy({ ...policy, ...patch });
  const setPriorityHours = (id: string, raw: string) => {
    const byPriority = { ...policy.byPriority };
    if (raw.trim() === "") delete byPriority[id];
    else byPriority[id] = Number(raw);
    set({ byPriority });
  };

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/settings", { method: "PATCH", json: { key: "sla", value: policy } });
      toast({ title: "SLA policy saved", description: policy.enabled ? "New tickets inherit targets from their priority." : "Priority-based targets are disabled.", variant: "success" });
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : "Failed to save", variant: "error" });
    } finally { setBusy(false); }
  };

  const totalTargets = Object.keys(policy.byPriority).length;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">SLA targets by priority</h2>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
              When enabled, every new ticket automatically receives a resolution deadline based on its priority.
              Tickets cross that deadline while still open are flagged as <span className="font-semibold text-destructive">SLA breached</span>,
              notified and recorded in history. An explicit due date on a ticket always overrides the automatic target.
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 pt-1 text-xs font-medium">
            <input type="checkbox" checked={policy.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="accent-primary" />
            {policy.enabled ? "Enabled" : "Disabled"}
          </label>
        </div>

        <fieldset disabled={!policy.enabled} className={!policy.enabled ? "opacity-50" : ""}>
          <div className="mt-5 overflow-hidden rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Priority</th>
                  <th className="py-2.5 pr-4 font-medium">Resolution target</th>
                  <th className="hidden py-2.5 pr-4 font-medium md:table-cell">Effective for new tickets</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {priorities.map((p) => {
                  const hours = policy.byPriority[p.id] ?? policy.defaultHours;
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2 text-xs font-medium">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />{p.name}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={1}
                            max={8760}
                            value={policy.byPriority[p.id] ?? ""}
                            placeholder={policy.defaultHours != null ? String(policy.defaultHours) : "-"}
                            onChange={(e) => setPriorityHours(p.id, e.target.value)}
                            className="h-8 w-20 rounded-md border border-input bg-card px-2 text-xs"
                            aria-label={`${p.name} resolution hours`}
                          />
                          <span className="text-[11px] text-muted-foreground">hours</span>
                        </div>
                      </td>
                      <td className="hidden py-2.5 pr-4 text-xs text-muted-foreground md:table-cell">{hours != null ? `${hours}h (${(hours / 24).toFixed(hours % 24 === 0 ? 0 : 1)} days)` : "No target"}</td>
                    </tr>
                  );
                })}
                <tr className="bg-muted/30">
                  <td className="px-4 py-2.5 text-xs font-semibold italic">Default fallback</td>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={8760}
                        value={policy.defaultHours ?? ""}
                        placeholder="-"
                        onChange={(e) => set({ defaultHours: e.target.value.trim() === "" ? null : Number(e.target.value) })}
                        className="h-8 w-20 rounded-md border border-input bg-card px-2 text-xs"
                        aria-label="Default resolution hours"
                      />
                      <span className="text-[11px] text-muted-foreground">hours</span>
                    </div>
                  </td>
                  <td className="hidden py-2.5 pr-4 text-xs text-muted-foreground md:table-cell">Used for priorities without a specific entry</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <div>
              <Label>At-risk window (hours before deadline)</Label>
              <Input type="number" min={1} max={720} value={policy.riskHours} onChange={(e) => set({ riskHours: Number(e.target.value) || 24 })} className="w-32" />
              <p className="mt-1 text-[10px] text-muted-foreground">Tickets inside this window show an amber AT RISK flag.</p>
            </div>
            <div className="pt-6">
              <p className="text-[11px] text-muted-foreground">
                Configured priority targets: <b>{totalTargets}</b> · changing a ticket&rsquo;s priority re-applies its target automatically.
              </p>
            </div>
          </div>
        </fieldset>

        <div className="mt-5 flex justify-end">
          <Button onClick={() => void save()} loading={busy}>Save SLA policy</Button>
        </div>
      </section>

      <section className="rounded-xl border border-dashed bg-card p-4 shadow-sm">
        <p className="text-xs leading-relaxed text-muted-foreground">
          How deadlines resolve: <b>manual due date</b> wins if set &rarr; otherwise the priority target measured from creation
          (&amp; re-measured when the priority changes) &rarr; otherwise no SLA. Breach detection runs every 5 minutes
          and flags each ticket exactly once; completing a ticket stops the clock.
        </p>
      </section>
    </div>
  );
}

function EmailTab() {
  const { toast } = useToast();
  const [cfg, setCfg] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ email?: Record<string, unknown> }>("/api/settings").then((d) => setCfg(d.email ?? {})).catch(() => setCfg({}));
  }, []);

  const save = async () => {
    try {
      await api("/api/settings", { method: "PATCH", json: { key: "email", value: cfg } });
      toast({ title: "Email configuration saved", variant: "success" });
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : "Failed", variant: "error" });
    }
  };
  const sendTest = async () => {
    setBusy(true);
    try {
      const d = await api<{ recipient: string; note: string }>("/api/settings/email/test", { method: "POST" });
      toast({ title: "Test email queued", description: `To ${d.recipient}. ${d.note}`, variant: "success" });
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : "Failed", variant: "error" });
    } finally { setBusy(false); }
  };

  if (!cfg) return <Skeleton className="h-80" />;
  const set = (k: string, v: unknown) => setCfg({ ...cfg, [k]: v });

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold">Email provider</h2>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <div>
            <Label required>Provider</Label>
            <Select value={String(cfg.provider ?? "console")} onChange={(e) => set("provider", e.target.value)}>
              <option value="console">Console (dev - logs emails)</option>
              <option value="smtp">SMTP / Gmail / Microsoft 365</option>
            </Select>
            <p className="mt-1 text-[10px] text-muted-foreground">Gmail/Outlook work via SMTP with an app password.</p>
          </div>
          <div><Label>From address</Label><Input value={String(cfg.from ?? "")} placeholder="TicketBooks &lt;no-reply@yourdomain.com&gt;" onChange={(e) => set("from", e.target.value)} /></div>

          {cfg.provider === "smtp" && (
            <>
              <div><Label>SMTP host</Label><Input value={String(cfg.smtpHost ?? "")} placeholder="smtp.gmail.com" onChange={(e) => set("smtpHost", e.target.value)} /></div>
              <div><Label>Port</Label><Input type="number" value={String(cfg.smtpPort ?? 587)} onChange={(e) => set("smtpPort", Number(e.target.value))} /></div>
              <div><Label>Username</Label><Input value={String(cfg.smtpUser ?? "")} onChange={(e) => set("smtpUser", e.target.value)} /></div>
              <div><Label>Password</Label><Input type="password" value={String(cfg.smtpPassword ?? "")} onChange={(e) => set("smtpPassword", e.target.value)} /></div>
              <label className="flex items-center gap-2 text-xs sm:col-span-2">
                <input type="checkbox" checked={Boolean(cfg.smtpSecure)} onChange={(e) => set("smtpSecure", e.target.checked)} className="accent-primary" />
                Use TLS/SSL (port 465)
              </label>
              <div className="sm:col-span-2"><Label>Test recipient (defaults to you)</Label><Input value={String(cfg.testRecipient ?? "")} placeholder="you@company.com" onChange={(e) => set("testRecipient", e.target.value)} /></div>
            </>
          )}
        </div>
        <div className="mt-4 flex justify-between">
          <Button variant="secondary" loading={busy} onClick={() => void sendTest()}><Send className="h-3.5 w-3.5" /> Send test email</Button>
          <Button onClick={() => void save()}>Save configuration</Button>
        </div>
      </section>

      <section className="rounded-xl border border-dashed bg-card p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold">Email-to-ticket</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Point your mail provider&rsquo;s inbound webhook at <code className="rounded bg-muted px-1 py-0.5">POST /api/email/inbound</code> with
          header <code className="rounded bg-muted px-1 py-0.5">x-strike-inbound-secret</code>. New subjects create tickets in the inbound project;
          replies containing <code className="rounded bg-muted px-1 py-0.5">[TICKET-KEY]</code> are added as comments.
        </p>
      </section>
    </div>
  );
}

function SecurityTab() {
  const [sec, setSec] = useState<Record<string, unknown> | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    api<{ security?: Record<string, unknown> }>("/api/settings").then((d) => setSec(d.security ?? {})).catch(() => setSec({}));
  }, []);

  const save = async () => {
    try {
      await api("/api/settings", { method: "PATCH", json: { key: "security", value: sec } });
      toast({ title: "Security settings saved", variant: "success" });
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : "Failed", variant: "error" });
    }
  };

  if (!sec) return <Skeleton className="h-56" />;
  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold">Password policy</h2>
        <div className="max-w-xs">
          <Label>Minimum password length</Label>
          <Input type="number" min={8} max={64} value={Number(sec.passwordMinLength ?? 10)}
            onChange={(e) => setSec({ ...sec, passwordMinLength: Number(e.target.value) })} />
        </div>
        <div className="mt-4 flex justify-end"><Button onClick={() => void save()}>Save policy</Button></div>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold">Sessions &amp; MFA</h2>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
          <li>Sessions are server-side records signed by an httpOnly cookie; they expire after 7 days of issue.</li>
          <li>Password reset invalidates all existing sessions for that user.</li>
          <li>TOTP-based MFA is architected via the users table (mfaSecret) and can be enforced per role.</li>
          <li>All logins, failed logins and administrative actions are recorded in the <a href="/audit-logs" className="font-medium text-primary hover:underline">Audit Logs</a>.</li>
        </ul>
      </section>
    </div>
  );
}

function AiToolsTab() {
  const [rows, setRows] = useState<{ clientId: string; name: string; connectedAt: string }[] | null>(null);
  const { toast } = useToast();
  const command = `claude mcp add --transport http strike ${typeof window === "undefined" ? "" : window.location.origin}/api/mcp`;

  const load = () => api<{ connections: NonNullable<typeof rows> }>("/api/oauth/connections").then((d) => setRows(d.connections)).catch(() => setRows([]));
  useEffect(() => { void load(); }, []);

  const disconnect = async (clientId: string, name: string) => {
    try {
      await api(`/api/oauth/connections?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" });
      toast({ title: `${name} disconnected`, variant: "success" });
      await load();
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : "Failed", variant: "error" });
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold">Connect Claude Code</h2>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          Run this in a terminal, then in Claude Code open <b>/mcp</b>, choose <b>strike</b> and <b>Authenticate</b>.
          You will sign in here and approve access. The AI acts as you, with exactly your permissions.
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs">{command}</code>
          <Button variant="secondary" onClick={() => { void navigator.clipboard?.writeText(command); toast({ title: "Copied", variant: "success" }); }}>Copy</Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Connected AI tools</h2>
        {rows === null ? <Skeleton className="h-16" /> : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No AI tools are connected to your account.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.clientId} className="flex items-center gap-3 py-2.5 text-sm">
                <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">Connected {new Date(r.connectedAt).toLocaleString()}</span>
                <Button variant="secondary" onClick={() => void disconnect(r.clientId, r.name)}>Disconnect</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
