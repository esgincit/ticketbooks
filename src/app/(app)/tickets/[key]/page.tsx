"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Eye, EyeOff, Hand, Trash2, Send, Paperclip, Pencil, X as CloseIcon,
} from "lucide-react";
import { api, ApiError } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Dropdown, DropdownItem } from "@/components/ui/dropdown";
import { Select, Skeleton, Label as FieldLabel, Input } from "@/components/ui/field";
import { StatusBadge, PriorityBadge, TypeIcon, DueBadge, LabelChip, SlaBadge, type SlaInfo } from "@/components/tickets/badges";
import { RichTextEditor } from "@/components/tickets/rich-text-editor";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/providers";
import { cn, fmtDate, fmtDateTime, dueLabel, timeAgo } from "@/lib/utils";
import CommentSection from "./comment-section";
import ActivityTimeline from "./activity-timeline";
import EmailThread from "./email-thread";
import TestCasesTab from "./test-cases-tab";

type UserRef = { id: string; firstName: string; lastName: string; email?: string; avatarUrl: string | null };
type TicketDetail = {
  id: string; key: string; number: number; title: string; description: string;
  project: { id: string; key: string; name: string };
  type: { id: string; name: string; icon: string };
  status: { id: string; name: string; color: string; category: string };
  priority: { id: string; name: string; color: string };
  sprint?: { id: string; name: string } | null;
  reporter: UserRef | null; assignee: UserRef | null;
  parent?: { id: string; key: string; title: string } | null;
  children: TicketDetail[];
  storyPoints: number | null; estimateMinutes: number | null;
  startDate: string | null; dueDate: string | null;
  createdAt: string; updatedAt: string; reopenedCount: number;
  labels: { id: string; name: string; color: string }[];
  watchers: UserRef[]; isWatching: boolean;
};
type Meta = {
  statuses: { id: string; name: string; category: string }[];
  priorities: { id: string; name: string; order: number }[];
  types: { id: string; name: string }[];
  sprints: { id: string; name: string }[];
  users: { id: string; firstName: string; lastName: string; email: string; avatarUrl: string | null }[];
};

type Payload = {
  ticket: TicketDetail;
  comments: unknown[]; history: unknown[]; attachments: AttachmentRow[]; emails: EmailRow[];
  permissions: { canEdit: boolean; canChangeStatus?: boolean; canAssign: boolean; canClaim: boolean; canDelete: boolean };
};
export type AttachmentRow = { id: string; fileName: string; mimeType: string; size: number; uploader: { firstName: string; lastName: string }; createdAt: string };
export type EmailRow = { id: string; direction: string; sender: string | null; recipients: string | null; subject: string; body: string | null; status: string; createdAt: string };

export default function TicketPage() {
  const { key } = useParams<{ key: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [data, setData] = useState<Payload | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"comments" | "activity" | "emails" | "tests">("comments");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyClaim, setBusyClaim] = useState(false);
  const [me, setMe] = useState<{ id: string } | null>(null);

  useEffect(() => {
    api<{ user: { id: string } }>("/api/auth/me").then((d) => setMe(d.user)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await api<Payload>(`/api/tickets/${key}`);
      setData(d);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load ticket");
    }
  }, [key]);

  useEffect(() => {
    void load();
    api<Meta>("/api/meta").then(setMeta).catch(() => {});
    // track recently viewed
    try {
      const cur = JSON.parse(localStorage.getItem("strike-recent-tickets") ?? "[]") as string[];
      localStorage.setItem("strike-recent-tickets", JSON.stringify([(key as string).toUpperCase(), ...cur.filter((k) => k !== (key as string).toUpperCase())].slice(0, 10)));
    } catch {}
    const onTicket = () => void load();
    window.addEventListener("strike:tickets-updated", onTicket);
    return () => window.removeEventListener("strike:tickets-updated", onTicket);
  }, [load, key]);

  if (error) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Link href="/tickets" className="mt-3 inline-block text-sm text-primary hover:underline">Back to tickets</Link>
      </div>
    );
  }
  if (!data) return <TicketSkeleton />;

  const t = data.ticket;
  const p = data.permissions;
  const slaInfo: SlaInfo | null = (t as unknown as { sla?: SlaInfo }).sla ?? null;
  const patch = async (json: Record<string, unknown>, okMsg?: string) => {
    try {
      await api(`/api/tickets/${t.key}`, { method: "PATCH", json });
      if (okMsg) toast({ title: okMsg, variant: "success" });
      await load();
      window.dispatchEvent(new CustomEvent("strike:tickets-updated"));
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : "Update failed", variant: "error" });
    }
  };

  const claim = async () => {
    setBusyClaim(true);
    try {
      await api(`/api/tickets/${t.key}/claim`, { method: "POST" });
      toast({ title: `You picked up ${t.key}`, variant: "success" });
      await load();
      window.dispatchEvent(new CustomEvent("strike:tickets-updated"));
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : "Could not claim ticket", variant: "error" });
    } finally {
      setBusyClaim(false);
    }
  };

  const toggleWatch = async () => {
    try {
      await api(`/api/tickets/${t.key}/watch`, { method: t.isWatching ? "DELETE" : "POST" });
      toast({ title: t.isWatching ? "Stopped watching" : "Now watching this ticket" });
      await load();
    } catch {
      toast({ title: "Action failed", variant: "error" });
    }
  };

  const uploadFile = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    let ok = 0;
    for (const file of Array.from(fileList)) {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch(`/api/tickets/${t.key}/attachments`, { method: "POST", body: fd });
        if (!res.ok) throw new Error((await res.json()).error ?? `Failed: ${file.name}`);
        ok++;
      } catch (e) {
        toast({ title: e instanceof Error ? e.message : `Failed: ${file.name}`, variant: "error" });
      }
    }
    if (ok) {
      toast({ title: ok === 1 ? "Attachment added" : `${ok} attachments added`, variant: "success" });
      await load();
    }
  };

  const dl = dueLabel(t.dueDate);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/projects" className="hover:text-primary hover:underline">Projects</Link> /
        <Link href={`/projects/${t.project.key}`} className="hover:text-primary hover:underline">{t.project.name}</Link> /
        <span className="font-mono font-semibold text-foreground">{t.key}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-5">
          {/* Header */}
          <header className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <TypeIcon name={t.type.name} />
                <span className="font-mono text-sm font-bold text-primary">{t.key}</span>
                {t.parent && (
                  <span className="text-xs text-muted-foreground">
                    parent <Link href={`/tickets/${t.parent.key}`} className="text-primary hover:underline">{t.parent.key}</Link>
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={toggleWatch}>
                  {t.isWatching ? <><EyeOff className="h-3.5 w-3.5" /> Stop watching</> : <><Eye className="h-3.5 w-3.5" /> Watch</>}
                </Button>
                {!t.assignee && p.canClaim && (
                  <Button size="sm" onClick={() => void claim()} loading={busyClaim}><Hand className="h-3.5 w-3.5" /> Pick ticket</Button>
                )}
                {p.canDelete && (
                  <Button variant="ghost" size="icon" aria-label="Archive ticket" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            </div>

            {editingTitle ? (
              <div className="flex gap-2">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { void patch({ title: titleDraft }, "Title updated"); setEditingTitle(false); } }}
                  autoFocus
                  className="w-full rounded-lg border border-input bg-card px-3 py-2 text-lg font-semibold focus:border-ring focus:outline-none"
                />
                <Button size="sm" onClick={() => { void patch({ title: titleDraft }, "Title updated"); setEditingTitle(false); }}>Save</Button>
                <Button variant="ghost" size="icon" onClick={() => setEditingTitle(false)}><CloseIcon className="h-4 w-4" /></Button>
              </div>
            ) : (
              <h1
                className={"text-xl font-bold leading-snug tracking-tight " + (p.canEdit ? "cursor-text hover:bg-muted/60 rounded-lg -mx-2 px-2 py-0.5" : "")}
                onClick={() => { if (p.canEdit) { setTitleDraft(t.title); setEditingTitle(true); } }}
                title={p.canEdit ? "Click to edit title" : undefined}
              >
                {t.title}
              </h1>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {meta && (p.canChangeStatus ?? p.canEdit) ? (
                <Dropdown trigger={<StatusBadge name={t.status.name} color={t.status.color} />}>
                  {(close) => meta.statuses.map((s) => (
                    <DropdownItem key={s.id} onClick={() => { close(); void patch({ statusId: s.id }, "Status changed"); }}>
                      <StatusBadge name={s.name} color="#52525b" size="sm" /> {s.name === t.status.name && "✓"}
                    </DropdownItem>
                  ))}
                </Dropdown>
              ) : <StatusBadge name={t.status.name} color={t.status.color} />}
              {meta && p.canAssign && (
                <Dropdown trigger={<PriorityBadge name={t.priority.name} color={t.priority.color} />}>
                  {(close) => meta.priorities.map((pr) => (
                    <DropdownItem key={pr.id} onClick={() => { close(); void patch({ priorityId: pr.id }, "Priority changed"); }}>{pr.name}{pr.id === t.priority.id ? " ✓" : ""}</DropdownItem>
                  ))}
                </Dropdown>
              )}
              {slaInfo && <SlaBadge sla={slaInfo} />}
              {t.reopenedCount > 0 && (
                <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">Reopened ×{t.reopenedCount}</span>
              )}
            </div>
          </header>

          {/* Description */}
          <section className="rounded-xl border bg-card shadow-sm">
            <div className="flex items-center justify-between px-4 pt-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</h2>
              {p.canEdit && !editingDesc && (
                <Button variant="ghost" size="sm" onClick={() => { setDescDraft(t.description); setEditingDesc(true); }}><Pencil className="h-3 w-3" /> Edit</Button>
              )}
            </div>
            {editingDesc ? (
              <div className="space-y-2 p-3">
                <RichTextEditor value={descDraft} onChange={setDescDraft} minHeight={160} />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditingDesc(false)}>Cancel</Button>
                  <Button size="sm" onClick={() => { void patch({ description: descDraft }, "Description updated"); setEditingDesc(false); }}>Save</Button>
                </div>
              </div>
            ) : (
              <div className="rte-content px-4 pb-4 pt-1 text-sm" dangerouslySetInnerHTML={{ __html: t.description || '<p class="text-muted-foreground">No description provided.</p>' }} />
            )}
          </section>

          {/* Attachments */}
          <Attachments attachments={data.attachments} onUpload={uploadFile} />

          {/* Tabs */}
          <section className="rounded-xl border bg-card shadow-sm">
            <div className="flex border-b" role="tablist">
              {([["comments", `Comments`], ["activity", "Activity"], ["emails", "Emails"], ["tests", "Test Cases"]] as const).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn("border-b-2 px-4 py-2.5 text-xs font-medium transition-colors",
                    tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                >
                  {label}{id === "comments" && data.comments.length > 0 ? ` (${data.comments.length})` : ""}
                  {id === "emails" && data.emails.length > 0 ? ` (${data.emails.length})` : ""}
                </button>
              ))}
            </div>
            {tab === "comments" && me && <CommentSection ticketKey={t.key} comments={data.comments as never} canComment me={me} onChange={load} />}
            {tab === "activity" && <ActivityTimeline history={data.history as never} />}
            {tab === "emails" && <EmailThread emails={data.emails} />}
            {tab === "tests" && <TestCasesTab ticketKey={t.key} />}
          </section>
        </div>

        {/* Metadata sidebar */}
        <aside className="space-y-4">
          <MetaBlock>
            {meta && p.canAssign && (
              <MetaRow label="Assignee">
                <Dropdown align="right" width="w-64" trigger={
                  <button className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-muted" aria-label="Change assignee">
                    {t.assignee ? (
                      <>
                        <Avatar user={t.assignee} size="xs" />
                        <span className="text-xs font-medium">{t.assignee.firstName} {t.assignee.lastName}</span>
                      </>
                    ) : (
                      <span className="text-xs font-medium text-primary">+ Assign</span>
                    )}
                  </button>
                }>
                  {(close) => (
                    <>
                      <DropdownItem onClick={() => { close(); void patch({ assigneeId: null }, "Unassigned"); }}>Unassigned</DropdownItem>
                      {meta.users.map((u) => (
                        <DropdownItem key={u.id} onClick={() => { close(); void patch({ assigneeId: u.id }, u.firstName === t.assignee?.firstName ? undefined : "Assigned"); }}>
                          {u.firstName} {u.lastName}
                        </DropdownItem>
                      ))}
                    </>
                  )}
                </Dropdown>
              </MetaRow>
            )}
            {!p.canAssign && <MetaRow label="Assignee">{t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : "Unassigned"}</MetaRow>}

            {meta && p.canEdit && (
              <MetaRow label="Type">
                <Select value={t.type.id} onChange={(e) => void patch({ typeId: e.target.value })} className="h-7 w-32 text-xs">{meta.types.map((ty) => <option key={ty.id} value={ty.id}>{ty.name}</option>)}</Select>
              </MetaRow>
            )}

            <MetaRow label="Reporter">{t.reporter ? `${t.reporter.firstName} ${t.reporter.lastName}` : "-"}</MetaRow>

            <MetaRow label="Due date">
              {p.canEdit ? (
                <input
                  type="date"
                  value={t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : ""}
                  onChange={(e) => void patch({ dueDate: e.target.value ? new Date(e.target.value + "T12:00:00").toISOString() : null }, "Due date changed")}
                  className="h-7 rounded-md border border-input bg-card px-2 text-xs"
                />
              ) : <DueBadge {...dl} />}
            </MetaRow>
            {p.canEdit && (
              <MetaRow label="Story points">
                <input
                  type="number"
                  min={0}
                  defaultValue={t.storyPoints ?? ""}
                  onBlur={(e) => { const v = e.target.value ? Number(e.target.value) : null; if (v !== t.storyPoints) void patch({ storyPoints: v }); }}
                  className="h-7 w-16 rounded-md border border-input bg-card px-2 text-xs"
                />
              </MetaRow>
            )}
            {meta && p.canEdit && (
              <MetaRow label="Sprint">
                <Select value={t.sprint?.id ?? ""} onChange={(e) => void patch({ sprintId: e.target.value || null })} className="h-7 w-40 text-xs">
                  <option value="">None</option>
                  {meta.sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </MetaRow>
            )}
          </MetaBlock>

          <MetaBlock title="Details">
            <MetaRow label="Created"><span title={fmtDateTime(t.createdAt)}>{timeAgo(t.createdAt)}</span></MetaRow>
            <MetaRow label="Updated">{timeAgo(t.updatedAt)}</MetaRow>
            <MetaRow label="Project"><Link href={`/projects/${t.project.key}`} className="text-primary hover:underline">{t.project.key}</Link></MetaRow>
          </MetaBlock>

          <MetaBlock title={`Watchers (${t.watchers.length})`}>
            <div className="flex flex-wrap gap-1.5">
              {t.watchers.map((w) => (
                <span key={w.id} className="flex items-center gap-1 rounded-full bg-muted py-0.5 pl-0.5 pr-2 text-[11px]">
                  <Avatar user={w} size="xs" /> {w.firstName}
                </span>
              ))}
              {t.watchers.length === 0 && <span className="text-[11px] text-muted-foreground">No watchers yet</span>}
            </div>
          </MetaBlock>

          {t.children.length > 0 && (
            <MetaBlock title={`Sub-tasks (${t.children.length})`}>
              <ul className="space-y-1">
                {t.children.map((c) => (
                  <li key={c.id}>
                    <Link href={`/tickets/${c.key}`} className="flex items-center gap-1.5 text-xs hover:text-primary">
                      <TypeIcon name={c.type.name} size="sm" />
                      <span className="truncate">{c.title}</span>
                      <StatusBadge name={c.status.name} color={c.status.color} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            </MetaBlock>
          )}

          {p.canEdit && (
            <CreateSubtask parentKey={t.key} onCreated={load} />
          )}
        </aside>
      </div>

      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api(`/api/tickets/${t.key}`, { method: "DELETE" }).catch(() => {});
          toast({ title: `${t.key} archived`, variant: "success" });
          router.push("/tickets");
        }}
        title={"Archive " + t.key + "?"}
        message="The ticket will be hidden from lists and boards. History is preserved."
        confirmLabel="Archive" danger
      />
    </div>
  );
}

function TicketSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Skeleton className="h-4 w-48" />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Skeleton className="h-8 w-96" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

function MetaBlock({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      {title && <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>}
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function Attachments({ attachments, onUpload }: { attachments: AttachmentRow[]; onUpload: (f: FileList | null) => void }) {
  const fmtSize = (n: number) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  const isImage = (m: string) => m.startsWith("image/");
  const [dragOver, setDragOver] = useState(false);
  const handlePaste = (e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length) {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length) {
        e.preventDefault();
        const dt = new DataTransfer();
        imageFiles.forEach((f) => dt.items.add(f));
        onUpload(dt.files);
      }
    }
  };

  return (
    <section
      className={cn("rounded-xl border bg-card p-4 shadow-sm transition-colors", dragOver && "border-primary bg-accent/30")}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onUpload(e.dataTransfer.files); }}
      onPaste={handlePaste}
      tabIndex={0}
    >
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attachments ({attachments.length})</h2>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed px-2.5 py-1 text-xs font-medium hover:bg-muted">
          <Paperclip className="h-3.5 w-3.5" /> Attach files
          <input
            type="file"
            hidden
            multiple
            accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
            onChange={(e) => { onUpload(e.target.files); e.currentTarget.value = ""; }}
          />
        </label>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">Drag & drop screenshots or documents, paste with Ctrl+V, or click to browse. Images, PDFs, Office docs, CSV, ZIP up to 20 MB each.</p>
      {attachments.length === 0 ? (
        <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">No files attached — drop screenshots or documents here.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {attachments.map((a) => (
            <li key={a.id} className="flex gap-3 rounded-lg border bg-card p-2.5">
              {isImage(a.mimeType) ? (
                <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  <img src={`/api/attachments/${a.id}`} alt={a.fileName} className="h-16 w-16 rounded-md object-cover border" loading="lazy" />
                </a>
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                  <Paperclip className="h-6 w-6" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <a href={`/api/attachments/${a.id}`} className="block truncate text-xs font-medium hover:text-primary hover:underline" title={a.fileName}>{a.fileName}</a>
                <span className="text-[11px] text-muted-foreground">{a.mimeType.split("/")[1]?.toUpperCase() || "FILE"} · {fmtSize(a.size)}</span>
                <span className="block text-[11px] text-muted-foreground">{a.uploader.firstName} · {fmtDate(a.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CreateSubtask({ parentKey, onCreated }: { parentKey: string; onCreated: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const create = async () => {
    setSaving(true);
    try {
      const parent = await api<{ projectId: string }>("/api/tickets/" + parentKey);
      const meta = await api<{ types: { id: string; name: string }[] }>("/api/meta");
      const subtaskType = meta.types.find((x) => x.name === "Sub-task")!;
      const created = await api<{ key: string }>("/api/tickets", {
        method: "POST",
        json: { projectId: parent.projectId, typeId: subtaskType.id, title, parentId: parentKey },
      });
      toast({ title: "Sub-task created", description: created.key, variant: "success" });
      setOpen(false);
      setTitle("");
      await onCreated();
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : "Could not create sub-task", variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>+ Add sub-task</Button>;
  }
  return (
    <div className="space-y-2 rounded-xl border bg-card p-3 shadow-sm">
      <FieldLabel required>Sub-task summary</FieldLabel>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" autoFocus onKeyDown={(e) => e.key === "Enter" && title.trim().length >= 3 && void create()} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" disabled={title.trim().length < 3} loading={saving} onClick={() => void create()}>Create</Button>
      </div>
    </div>
  );
}
