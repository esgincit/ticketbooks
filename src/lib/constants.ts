export const SESSION_COOKIE = "strike_session";
export const CSRF_HEADER = "x-strike-csrf";

// Permission catalog (configurable per role via roles.permissions JSON)
export const PERMISSION_CATALOG: { key: string; label: string; description: string }[] = [
  { key: "*", label: "All permissions", description: "Super admin bypass" },
  { key: "user.manage", label: "Manage users", description: "Create, edit, disable, delete users" },
  { key: "user.view", label: "View users", description: "View user directory" },
  { key: "team.manage", label: "Manage teams", description: "Create/edit teams and membership" },
  { key: "team.view", label: "View teams", description: "View team pages" },
  { key: "project.manage", label: "Manage projects", description: "Create/edit projects, workflows, types" },
  { key: "project.view", label: "View projects", description: "Browse projects" },
  { key: "ticket.create", label: "Create tickets", description: "Create tickets in permitted projects" },
  { key: "ticket.edit.team", label: "Edit team tickets", description: "Edit any ticket visible to the manager's team" },
  { key: "ticket.edit.assigned", label: "Edit own tickets", description: "Edit tickets assigned to or reported by self" },
  { key: "ticket.assign", label: "Assign tickets", description: "Assign/reassign tickets to others" },
  { key: "ticket.claim", label: "Claim tickets", description: "Pick up unassigned tickets" },
  { key: "ticket.delete.team", label: "Delete team tickets", description: "Archive/delete tickets in the team scope" },
  { key: "subtask.create", label: "Create subtasks", description: "Add subtasks under tickets" },
  { key: "ticket.comment", label: "Comment", description: "Add comments to accessible tickets" },
  { key: "ticket.watch", label: "Watch tickets", description: "Watch/unwatch tickets" },
  { key: "report.view.team", label: "Team reports", description: "Reports scoped to managed team" },
  { key: "report.view.all", label: "Org reports", description: "Organization-wide reports" },
  { key: "audit.view", label: "View audit logs", description: "Access the audit trail" },
  { key: "settings.manage", label: "Manage settings", description: "Org settings, email config, templates" },
  { key: "notification.receive", label: "Notifications", description: "Receive in-app notifications" },
  { key: "testcase.manage", label: "Manage tests", description: "Create, edit and delete test cases, plans and suites; assign testers" },
  { key: "testcase.execute", label: "Run tests", description: "Record test results and link automated tests" },
];

export const NOTIF_TYPES = {
  TICKET_ASSIGNED: "TICKET_ASSIGNED",
  TICKET_REASSIGNED: "TICKET_REASSIGNED",
  TICKET_CLAIMED: "TICKET_CLAIMED",
  STATUS_CHANGED: "STATUS_CHANGED",
  PRIORITY_CHANGED: "PRIORITY_CHANGED",
  DUE_CHANGED: "DUE_CHANGED",
  COMMENT_ADDED: "COMMENT_ADDED",
  MENTION: "MENTION",
  TICKET_RESOLVED: "TICKET_RESOLVED",
  TICKET_REOPENED: "TICKET_REOPENED",
  TICKET_OVERDUE: "TICKET_OVERDUE",
  WATCH_UPDATED: "WATCH_UPDATED",
} as const;

export const EMAIL_TEMPLATES = [
  "ticket_created",
  "ticket_assigned",
  "ticket_reassigned",
  "status_changed",
  "priority_changed",
  "due_date_changed",
  "comment_added",
  "mention",
  "ticket_resolved",
  "ticket_reopened",
  "ticket_overdue",
  "user_invitation",
  "otp_verification",
  "email_verification",
  "password_reset_otp",
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATES)[number];
