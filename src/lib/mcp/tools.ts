/**
 * MCP tool catalogue. Every tool calls the SAME route handler the web app uses,
 * in-process, so validation, RBAC, audit, notifications and emails behave
 * identically. The caller is resolved from the Bearer token by getSessionUser().
 */
import * as me from "@/app/api/auth/me/route";
import * as meta from "@/app/api/meta/route";
import * as dashboard from "@/app/api/dashboard/route";
import * as reports from "@/app/api/reports/route";
import * as search from "@/app/api/search/route";
import * as tickets from "@/app/api/tickets/route";
import * as ticket from "@/app/api/tickets/[key]/route";
import * as assign from "@/app/api/tickets/[key]/assign/route";
import * as claim from "@/app/api/tickets/[key]/claim/route";
import * as watch from "@/app/api/tickets/[key]/watch/route";
import * as ticketComments from "@/app/api/tickets/[key]/comments/route";
import * as ticketAttachments from "@/app/api/tickets/[key]/attachments/route";
import * as attachment from "@/app/api/attachments/[id]/route";
import * as comment from "@/app/api/comments/[id]/route";
import * as bulk from "@/app/api/bulk/route";
import * as projects from "@/app/api/projects/route";
import * as project from "@/app/api/projects/[key]/route";
import * as teams from "@/app/api/teams/route";
import * as team from "@/app/api/teams/[id]/route";
import * as users from "@/app/api/users/route";
import * as userById from "@/app/api/users/[id]/route";
import * as roles from "@/app/api/roles/route";
import * as notifications from "@/app/api/notifications/route";
import * as notificationRead from "@/app/api/notifications/[id]/read/route";
import * as audit from "@/app/api/audit/route";
import * as settings from "@/app/api/settings/route";
import * as emailTest from "@/app/api/settings/email/test/route";
import * as connections from "@/app/api/oauth/connections/route";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Args = Record<string, unknown>;
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export type ToolResult = { content: Content[]; isError?: boolean };

type Tool = {
  name: string;
  description: string;
  props?: Record<string, object>;
  required?: string[];
  method: "GET" | "POST" | "PATCH" | "DELETE";
  handler: unknown;
  /** URL path; `{name}` segments are filled from args and removed from the body/query */
  path: string;
  /** Fixed body instead of the remaining args */
  body?: unknown;
  /** Custom request/response handling (multipart upload, binary download) */
  run?: (args: Args, call: (init: RequestInit, args: Args) => Promise<Response>) => Promise<ToolResult>;
};

// JSON-schema shorthands
const str = (description: string) => ({ type: "string", description });
const nstr = (description: string) => ({ type: ["string", "null"], description });
const int = (description: string) => ({ type: "integer", description });
const nint = (description: string) => ({ type: ["integer", "null"], description });
const bool = (description: string) => ({ type: "boolean", description });
const strs = (description: string) => ({ type: "array", items: { type: "string" }, description });
const oneOf = (values: string[], description: string) => ({ type: "string", enum: values, description });

const KEY = { key: str("Ticket key, e.g. OPS-1042") };
const IDS = "IDs come from get_reference_data";
const DATE = "ISO 8601 datetime with offset, e.g. 2026-11-01T17:00:00Z; null clears";
const HTML = "HTML (plain text is fine)";

const ticketFields = {
  title: str("Title (3-300 chars)"),
  description: str(`Description, ${HTML}`),
  typeId: str(`Ticket type ID (${IDS})`),
  statusId: str(`Status ID (${IDS})`),
  priorityId: str(`Priority ID (${IDS})`),
  assigneeId: nstr("Assignee user ID, null = unassigned"),
  sprintId: nstr("Sprint ID, null = none"),
  dueDate: nstr(DATE),
  startDate: nstr(DATE),
  storyPoints: nint("Story points 0-1000"),
  estimateMinutes: nint("Estimate in minutes"),
  labelIds: strs("Label IDs (replaces the set)"),
};

export const TOOLS: Tool[] = [
  // --- Me & reference data -------------------------------------------------
  { name: "whoami", description: "Current user profile, role, permissions and unread notification count.", method: "GET", handler: me.GET, path: "/api/auth/me" },
  {
    name: "update_my_profile", description: "Update your own profile.", method: "PATCH", handler: me.PATCH, path: "/api/auth/me",
    props: { firstName: str("First name"), lastName: str("Last name"), jobTitle: nstr("Job title"), phone: nstr("Phone"), timeZone: nstr("IANA time zone"), prefs: { type: "object", description: "UI preferences object" } },
  },
  { name: "get_reference_data", description: "All IDs needed by other tools: statuses, priorities, ticket types, projects, users, labels, active/planned sprints, teams. Call this first.", method: "GET", handler: meta.GET, path: "/api/meta" },
  { name: "get_dashboard", description: "Dashboard data for the current user (employee or manager view).", method: "GET", handler: dashboard.GET, path: "/api/dashboard" },
  {
    name: "get_report", description: "Reports (needs report.view.team or report.view.all).", method: "GET", handler: reports.GET, path: "/api/reports",
    props: { type: oneOf(["overview", "workload", "aging", "created-completed", "user-trend"], "Report type (default overview)"), days: int("Look-back window in days (default 30)"), userId: str("User ID, for type=user-trend"), export: oneOf(["csv"], "Return CSV instead of JSON") },
  },

  // --- Tickets --------------------------------------------------------------
  { name: "search_tickets", description: "Quick search by ticket key or text in title/description (max 15 results).", method: "GET", handler: search.GET, path: "/api/search", props: { q: str("Search text or ticket key") }, required: ["q"] },
  {
    name: "list_tickets", description: "List/filter tickets visible to you, paginated. Comma-separate multiple IDs.", method: "GET", handler: tickets.GET, path: "/api/tickets",
    props: {
      q: str("Text or ticket key"), projectId: str("Project ID(s), csv"), statusIds: str("Status IDs, csv"), priorityIds: str("Priority IDs, csv"), typeIds: str("Type IDs, csv"),
      assigneeId: str('"me", "unassigned", or user ID(s) csv'), reporterId: str('"me" or user ID'), labelId: str("Label ID"), sprintId: str('Sprint ID or "none"'),
      watchedByMe: oneOf(["true"], "Only tickets you watch"), dueWithinDays: int("Due within N days (0-365)"), overdue: oneOf(["true"], "Only overdue"),
      sla: oneOf(["any", "breached", "at_risk", "on_track", "met"], "SLA state"), parentIdNull: oneOf(["true"], "Only top-level (no subtasks)"),
      sort: oneOf(["created_desc", "updated_desc", "due_asc", "priority_asc", "priority_desc", "key_asc"], "Sort order"),
      page: int("Page (default 1)"), pageSize: int("Page size 1-200 (default 25)"),
    },
  },
  { name: "get_ticket", description: "Full ticket: fields, subtasks, labels, watchers, comments, history, attachments, emails, SLA and what you may do with it.", method: "GET", handler: ticket.GET, path: "/api/tickets/{key}", props: KEY, required: ["key"] },
  {
    name: "create_ticket", description: "Create a ticket (or a subtask via parentId).", method: "POST", handler: tickets.POST, path: "/api/tickets",
    props: { projectId: str(`Project ID (${IDS})`), ...ticketFields, parentId: nstr("Parent ticket ID to create a subtask"), watcherIds: strs("Watcher user IDs") },
    required: ["projectId", "typeId", "title"],
  },
  { name: "update_ticket", description: "Update ticket fields (status, priority, assignee, dates, labels, ...). Only send fields to change.", method: "PATCH", handler: ticket.PATCH, path: "/api/tickets/{key}", props: { ...KEY, ...ticketFields }, required: ["key"] },
  { name: "delete_ticket", description: "Archive (soft-delete) a ticket.", method: "DELETE", handler: ticket.DELETE, path: "/api/tickets/{key}", props: KEY, required: ["key"] },
  { name: "assign_ticket", description: "Assign or unassign a ticket.", method: "POST", handler: assign.POST, path: "/api/tickets/{key}/assign", props: { ...KEY, assigneeId: nstr("User ID, null = unassign") }, required: ["key", "assigneeId"] },
  { name: "claim_ticket", description: "Assign an unassigned ticket to yourself.", method: "POST", handler: claim.POST, path: "/api/tickets/{key}/claim", props: KEY, required: ["key"] },
  { name: "watch_ticket", description: "Start watching a ticket.", method: "POST", handler: watch.POST, path: "/api/tickets/{key}/watch", props: KEY, required: ["key"] },
  { name: "unwatch_ticket", description: "Stop watching a ticket.", method: "DELETE", handler: watch.DELETE, path: "/api/tickets/{key}/watch", props: KEY, required: ["key"] },
  {
    name: "bulk_update_tickets", description: "Apply one action to up to 100 tickets.", method: "PATCH", handler: bulk.PATCH, path: "/api/bulk",
    props: { keys: strs("Ticket keys"), action: oneOf(["assign", "status", "priority", "label", "delete"], "Action"), value: nstr("User/status/priority/label ID (null to unassign; ignored for delete)") },
    required: ["keys", "action", "value"],
  },

  // --- Comments -------------------------------------------------------------
  { name: "list_comments", description: "Comments on a ticket.", method: "GET", handler: ticketComments.GET, path: "/api/tickets/{key}/comments", props: KEY, required: ["key"] },
  { name: "add_comment", description: "Comment on a ticket (reply via parentId).", method: "POST", handler: ticketComments.POST, path: "/api/tickets/{key}/comments", props: { ...KEY, body: str(`Comment, ${HTML}`), parentId: nstr("Comment ID to reply to") }, required: ["key", "body"] },
  { name: "edit_comment", description: "Edit your own comment.", method: "PATCH", handler: comment.PATCH, path: "/api/comments/{id}", props: { id: str("Comment ID"), body: str(`New text, ${HTML}`) }, required: ["id", "body"] },
  { name: "delete_comment", description: "Delete a comment.", method: "DELETE", handler: comment.DELETE, path: "/api/comments/{id}", props: { id: str("Comment ID") }, required: ["id"] },

  // --- Attachments ----------------------------------------------------------
  {
    name: "upload_attachment", description: "Attach a file to a ticket. Allowed: png jpg jpeg gif webp pdf doc docx xls xlsx csv txt zip (about 4MB max on serverless hosting).", method: "POST", handler: ticketAttachments.POST, path: "/api/tickets/{key}/attachments",
    props: { ...KEY, fileName: str("File name with extension"), contentBase64: str("File content, base64"), mimeType: str("MIME type"), commentId: str("Attach to this comment") },
    required: ["key", "fileName", "contentBase64"],
    run: async (a, call) => {
      const form = new FormData();
      form.set("file", new File([Buffer.from(String(a.contentBase64), "base64")], String(a.fileName), { type: a.mimeType ? String(a.mimeType) : "" }));
      if (a.commentId) form.set("commentId", String(a.commentId));
      return toResult(await call({ method: "POST", body: form }, a));
    },
  },
  {
    name: "download_attachment", description: "Download an attachment (ID from get_ticket). Images come back as images, text as text, other files as base64.", method: "GET", handler: attachment.GET, path: "/api/attachments/{id}",
    props: { id: str("Attachment ID") }, required: ["id"],
    run: async (a, call) => {
      const res = await call({ method: "GET" }, a);
      if (!res.ok) return toResult(res);
      const type = res.headers.get("content-type") ?? "application/octet-stream";
      const buf = Buffer.from(await res.arrayBuffer());
      if (/^image\/(png|jpeg|gif|webp)$/.test(type)) return { content: [{ type: "image", data: buf.toString("base64"), mimeType: type }] };
      if (/^text\/|json|csv|xml/.test(type)) return { content: [{ type: "text", text: buf.toString("utf8") }] };
      return { content: [{ type: "text", text: JSON.stringify({ mimeType: type, size: buf.length, contentBase64: buf.toString("base64") }) }] };
    },
  },

  // --- Projects ---------------------------------------------------------------
  { name: "list_projects", description: "Active projects with ticket counts.", method: "GET", handler: projects.GET, path: "/api/projects" },
  { name: "get_project", description: "Project details: team, sprints, labels, status and priority breakdown.", method: "GET", handler: project.GET, path: "/api/projects/{key}", props: { key: str("Project key, e.g. OPS") }, required: ["key"] },
  {
    name: "create_project", description: "Create a project (needs project.manage).", method: "POST", handler: projects.POST, path: "/api/projects",
    props: { name: str("Name"), key: str("Key: 2-10 letters/digits starting with a letter"), description: str("Description"), leadId: nstr("Lead user ID"), teamId: nstr("Team ID") },
    required: ["name", "key"],
  },
  {
    name: "update_project", description: "Update or archive a project (needs project.manage).", method: "PATCH", handler: project.PATCH, path: "/api/projects/{key}",
    props: { key: str("Project key"), name: str("Name"), description: nstr("Description"), leadId: nstr("Lead user ID"), teamId: nstr("Team ID"), archived: bool("Archive the project") },
    required: ["key"],
  },

  // --- Teams ------------------------------------------------------------------
  { name: "list_teams", description: "Teams with manager, members and projects.", method: "GET", handler: teams.GET, path: "/api/teams" },
  { name: "create_team", description: "Create a team (needs team.manage).", method: "POST", handler: teams.POST, path: "/api/teams", props: { name: str("Name"), description: str("Description"), managerId: nstr("Manager user ID") }, required: ["name"] },
  {
    name: "update_team", description: "Rename a team, change its manager, add/remove members (needs team.manage).", method: "PATCH", handler: team.PATCH, path: "/api/teams/{id}",
    props: { id: str("Team ID"), name: str("Name"), description: nstr("Description"), managerId: nstr("Manager user ID"), addMemberIds: strs("User IDs to add"), removeMemberIds: strs("User IDs to remove") },
    required: ["id"],
  },
  { name: "delete_team", description: "Delete an empty team (needs team.manage).", method: "DELETE", handler: team.DELETE, path: "/api/teams/{id}", props: { id: str("Team ID") }, required: ["id"] },

  // --- Users & roles ------------------------------------------------------------
  { name: "list_users", description: "User directory with open/completed ticket counts.", method: "GET", handler: users.GET, path: "/api/users", props: { q: str("Name or email"), teamId: str("Team ID"), page: int("Page"), pageSize: int("Page size (max 100)") } },
  { name: "get_user", description: "User profile and ticket stats.", method: "GET", handler: userById.GET, path: "/api/users/{id}", props: { id: str("User ID") }, required: ["id"] },
  {
    name: "create_user", description: "Create a user (needs user.manage). Returns a temp password unless one is given.", method: "POST", handler: users.POST, path: "/api/users",
    props: { firstName: str("First name"), lastName: str("Last name"), email: str("Email"), password: str("Initial password (min 8)"), roleId: str("Role ID (list_roles)"), teamId: nstr("Team ID"), jobTitle: str("Job title"), phone: str("Phone"), timeZone: str("IANA time zone"), sendInviteEmail: bool("Email an invitation") },
    required: ["firstName", "lastName", "email", "roleId"],
  },
  {
    name: "update_user", description: "Update a user, change role/team, disable, or reset password (needs user.manage).", method: "PATCH", handler: userById.PATCH, path: "/api/users/{id}",
    props: { id: str("User ID"), firstName: str("First name"), lastName: str("Last name"), jobTitle: nstr("Job title"), phone: nstr("Phone"), timeZone: nstr("Time zone"), roleId: str("Role ID"), teamId: nstr("Team ID"), status: oneOf(["ACTIVE", "INVITED", "DISABLED"], "Status"), resetPassword: bool("Generate a new temp password") },
    required: ["id"],
  },
  { name: "delete_user", description: "Permanently delete a user (needs user.manage).", method: "DELETE", handler: userById.DELETE, path: "/api/users/{id}", props: { id: str("User ID") }, required: ["id"] },
  { name: "list_roles", description: "Roles and the permission catalog (needs user.manage).", method: "GET", handler: roles.GET, path: "/api/roles" },

  // --- Notifications ----------------------------------------------------------
  { name: "list_notifications", description: "Your notifications, 25 per page.", method: "GET", handler: notifications.GET, path: "/api/notifications", props: { unread: oneOf(["true"], "Only unread"), page: int("Page") } },
  { name: "mark_notification_read", description: "Mark one notification as read.", method: "PATCH", handler: notificationRead.PATCH, path: "/api/notifications/{id}/read", props: { id: str("Notification ID") }, required: ["id"] },
  { name: "mark_all_notifications_read", description: "Mark all your notifications as read.", method: "POST", handler: notifications.POST, path: "/api/notifications", body: { action: "markAllRead" } },

  // --- Admin ----------------------------------------------------------------------
  { name: "list_audit_logs", description: "Audit trail, 50 per page (needs audit.view).", method: "GET", handler: audit.GET, path: "/api/audit", props: { page: int("Page"), q: str("Entity type or user"), action: str("Action contains, e.g. LOGIN") } },
  { name: "get_settings", description: "Organization settings (full set for admins).", method: "GET", handler: settings.GET, path: "/api/settings" },
  {
    name: "update_setting", description: "Replace one settings group (needs settings.manage). Read get_settings first and send the whole object.", method: "PATCH", handler: settings.PATCH, path: "/api/settings",
    props: { key: oneOf(["organization", "email", "security", "templates", "automation", "sla"], "Settings group"), value: { type: "object", description: "New value for the group" } },
    required: ["key", "value"],
  },
  { name: "send_test_email", description: "Queue a test email using the current email settings.", method: "POST", handler: emailTest.POST, path: "/api/settings/email/test" },

  // --- AI tool connections ----------------------------------------------------------
  { name: "list_ai_connections", description: "AI tools connected to your account.", method: "GET", handler: connections.GET, path: "/api/oauth/connections" },
  { name: "disconnect_ai_tool", description: "Revoke an AI tool's access to your account (this one too, if you pass its ID).", method: "DELETE", handler: connections.DELETE, path: "/api/oauth/connections", props: { clientId: str("Client ID from list_ai_connections") }, required: ["clientId"] },
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

export function listTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: { type: "object", properties: t.props ?? {}, required: t.required ?? [] },
    annotations: { readOnlyHint: t.method === "GET", destructiveHint: t.method === "DELETE" || t.name === "bulk_update_tickets" },
  }));
}

export function hasTool(name: string) {
  return byName.has(name);
}

/** Runs a tool by invoking its route handler with a synthesized request */
export async function callTool(name: string, args: Args, origin: string, forwardedFor: string): Promise<ToolResult> {
  const tool = byName.get(name)!;
  const call = async (init: RequestInit, a: Args) => {
    const rest = { ...a };
    const params: Record<string, string> = {};
    const path = tool.path.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = rest[k];
      if (v === undefined || v === null || v === "") throw new Error(`Missing required argument: ${k}`);
      delete rest[k];
      params[k] = String(v);
      return encodeURIComponent(String(v));
    });
    const url = new URL(path, origin);
    const headers = new Headers({ "x-forwarded-for": forwardedFor, "user-agent": "strike-mcp" });
    if (init.body === undefined && (tool.method === "GET" || tool.method === "DELETE")) {
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    } else if (init.body === undefined) {
      headers.set("content-type", "application/json");
      init = { ...init, body: JSON.stringify(tool.body ?? rest) };
    }
    return (tool.handler as Handler)(new Request(url, { ...init, headers }), { params: Promise.resolve(params) });
  };
  try {
    return tool.run ? await tool.run(args, call) : toResult(await call({ method: tool.method }, args));
  } catch (e) {
    return { content: [{ type: "text", text: e instanceof Error ? e.message : "Tool failed" }], isError: true };
  }
}

async function toResult(res: Response): Promise<ToolResult> {
  const text = await res.text();
  return { content: [{ type: "text", text: text || `HTTP ${res.status}` }], isError: !res.ok };
}
