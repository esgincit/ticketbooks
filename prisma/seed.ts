import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  console.log("Seeding Strike demo environment...");

  // Wipe (order matters for FKs)
  await db.$transaction([
    db.customFieldValue.deleteMany(),
    db.customFieldDef.deleteMany(),
    db.automationRule.deleteMany(),
    db.savedFilter.deleteMany(),
    db.auditLog.deleteMany(),
    db.emailEvent.deleteMany(),
    db.notification.deleteMany(),
    db.ticketHistory.deleteMany(),
    db.attachment.deleteMany(),
    db.comment.deleteMany(),
    db.ticketWatcher.deleteMany(),
    db.ticketLabel.deleteMany(),
    db.ticket.deleteMany(),
    db.sprint.deleteMany(),
    db.label.deleteMany(),
    db.projectMember.deleteMany(),
    db.project.deleteMany(),
    db.passwordResetToken.deleteMany(),
    db.session.deleteMany(),
    db.user.deleteMany(),
    db.team.deleteMany(),
    db.role.deleteMany(),
    db.status.deleteMany(),
    db.priority.deleteMany(),
    db.ticketType.deleteMany(),
    db.setting.deleteMany(),
  ]);

  const password = await bcrypt.hash("Password123!", 10);

  // ---------------- Roles & permissions ----------------
  const ALL_PERMS = ["*"];
  const adminRole = await db.role.create({
    data: { name: "Admin", description: "Full system access", permissions: ALL_PERMS, isSystem: true },
  });
  const managerRole = await db.role.create({
    data: {
      name: "Manager",
      description: "Team lead - manage team work",
      isSystem: true,
      permissions: [
        "ticket.create", "ticket.edit.team", "ticket.assign", "ticket.claim", "ticket.delete.team",
        "ticket.comment", "ticket.watch", "subtask.create", "report.view.team", "user.view",
        "team.view", "project.view", "project.manage", "dashboard.view", "notification.receive",
        "testcase.manage", "testcase.execute",
      ],
    },
  });
  const employeeRole = await db.role.create({
    data: {
      name: "Employee",
      description: "Team member - works on assigned tickets",
      isSystem: true,
      permissions: [
        "ticket.edit.assigned", "ticket.claim", "ticket.comment", "ticket.watch",
        "subtask.create", "dashboard.view", "project.view", "team.view.self", "notification.receive",
        "testcase.manage", "testcase.execute",
      ],
    },
  });

  // ---------------- Workflow config ----------------
  const statusData = [
    { name: "Open", category: "TODO", color: "#64748b", order: 1, isDefault: true },
    { name: "To Do", category: "TODO", color: "#64748b", order: 2 },
    { name: "In Progress", category: "IN_PROGRESS", color: "#2563eb", order: 3 },
    { name: "Blocked", category: "IN_PROGRESS", color: "#dc2626", order: 4 },
    { name: "In Review", category: "IN_PROGRESS", color: "#7c3aed", order: 5 },
    { name: "Resolved", category: "DONE", color: "#059669", order: 6 },
    { name: "Done", category: "DONE", color: "#059669", order: 7 },
    { name: "Closed", category: "DONE", color: "#334155", order: 8 },
    { name: "Reopened", category: "TODO", color: "#d97706", order: 9 },
  ];
  const statuses: Record<string, { id: string }> = {};
  for (const s of statusData) statuses[s.name] = await db.status.create({ data: s });

  const prioData = [
    { name: "Critical", color: "#b91c1c", order: 5 },
    { name: "Highest", color: "#dc2626", order: 4 },
    { name: "High", color: "#ea580c", order: 3 },
    { name: "Medium", color: "#ca8a04", order: 2, isDefault: true },
    { name: "Low", color: "#16a34a", order: 1 },
    { name: "Lowest", color: "#0d9488", order: 0 },
  ];
  const priorities: Record<string, { id: string }> = {};
  for (const p of prioData) priorities[p.name] = await db.priority.create({ data: p });

  const typeData = [
    { name: "Task", icon: "check-square", order: 1 },
    { name: "Bug", icon: "bug", order: 2 },
    { name: "Story", icon: "book-open", order: 3 },
    { name: "Improvement", icon: "arrow-up-right", order: 4 },
    { name: "Feature", icon: "sparkles", order: 5 },
    { name: "Support", icon: "life-buoy", order: 6 },
    { name: "Request", icon: "inbox", order: 7 },
    { name: "Epic", icon: "milestone", order: 8 },
    { name: "Sub-task", icon: "git-branch", isSubtask: true, order: 9 },
  ];
  const types: Record<string, { id: string }> = {};
  for (const t of typeData) types[t.name] = await db.ticketType.create({ data: t });

  // ---------------- Teams ----------------
  const eng = await db.team.create({ data: { name: "Engineering", description: "Product engineering team" } });
  const qa = await db.team.create({ data: { name: "QA", description: "Quality assurance" } });
  const support = await db.team.create({ data: { name: "Support", description: "Customer support operations" } });

  // ---------------- Users ----------------
  async function createUser(opts: {
    firstName: string; lastName: string; email: string; roleId: string; teamId?: string;
    jobTitle?: string; phone?: string; timeZone?: string;
  }) {
    return db.user.create({
      data: { ...opts, passwordHash: password, status: "ACTIVE", emailVerifiedAt: new Date() },
    });
  }

  const admin = await createUser({ firstName: "Sunil", lastName: "Vootkuri", email: "admin@strike.io", roleId: adminRole.id, jobTitle: "System Administrator", timeZone: "Asia/Kolkata" });
  const meera = await createUser({ firstName: "Meera", lastName: "Nair", email: "meera@strike.io", roleId: managerRole.id, teamId: eng.id, jobTitle: "Engineering Manager", timeZone: "Asia/Kolkata" });
  const rohan = await createUser({ firstName: "Rohan", lastName: "Gupta", email: "rohan@strike.io", roleId: managerRole.id, teamId: qa.id, jobTitle: "QA Lead", timeZone: "Asia/Kolkata" });
  const divya = await createUser({ firstName: "Divya", lastName: "Sharma", email: "divya@strike.io", roleId: managerRole.id, teamId: support.id, jobTitle: "Support Lead", timeZone: "Asia/Kolkata" });
  const rahul = await createUser({ firstName: "Rahul", lastName: "Verma", email: "rahul@strike.io", roleId: employeeRole.id, teamId: eng.id, jobTitle: "Backend Engineer", timeZone: "Asia/Kolkata" });
  const priya = await createUser({ firstName: "Priya", lastName: "Iyer", email: "priya@strike.io", roleId: employeeRole.id, teamId: eng.id, jobTitle: "Frontend Engineer", timeZone: "Asia/Kolkata" });
  const arjun = await createUser({ firstName: "Arjun", lastName: "Patel", email: "arjun@strike.io", roleId: employeeRole.id, teamId: eng.id, jobTitle: "Full-stack Engineer", timeZone: "Asia/Kolkata" });
  const sneha = await createUser({ firstName: "Sneha", lastName: "Reddy", email: "sneha@strike.io", roleId: employeeRole.id, teamId: qa.id, jobTitle: "QA Engineer", timeZone: "Asia/Kolkata" });
  const vikram = await createUser({ firstName: "Vikram", lastName: "Singh", email: "vikram@strike.io", roleId: employeeRole.id, teamId: qa.id, jobTitle: "Automation Engineer", timeZone: "Asia/Kolkata" });
  const neha = await createUser({ firstName: "Neha", lastName: "Joshi", email: "neha@strike.io", roleId: employeeRole.id, teamId: support.id, jobTitle: "Support Specialist", timeZone: "Asia/Kolkata" });
  const karan = await createUser({ firstName: "Karan", lastName: "Malhotra", email: "karan@strike.io", roleId: employeeRole.id, teamId: support.id, jobTitle: "Support Specialist", timeZone: "Asia/Kolkata" });

  await db.team.update({ where: { id: eng.id }, data: { managerId: meera.id } });
  await db.team.update({ where: { id: qa.id }, data: { managerId: rohan.id } });
  await db.team.update({ where: { id: support.id }, data: { managerId: divya.id } });

  // ---------------- Projects ----------------
  const web = await db.project.create({
    data: {
      key: "WEB", name: "Website", description: "Public marketing site and customer portal",
      leadId: meera.id, teamId: eng.id,
      members: { create: [{ userId: rahul.id }, { userId: priya.id }, { userId: sneha.id }] },
      nextNumber: 1000,
    },
  });
  const mob = await db.project.create({
    data: {
      key: "MOB", name: "Mobile Application", description: "iOS and Android customer app",
      leadId: meera.id, teamId: eng.id,
      members: { create: [{ userId: arjun.id }, { userId: priya.id }, { userId: vikram.id }] },
      nextNumber: 1000,
    },
  });
  const ops = await db.project.create({
    data: {
      key: "OPS", name: "Internal Operations", description: "Internal tooling and process requests",
      leadId: divya.id, teamId: support.id,
      members: { create: [{ userId: neha.id }, { userId: karan.id }, { userId: vikram.id }] },
      nextNumber: 1000,
    },
  });

  // ---------------- Labels ----------------
  const mkLabel = (name: string, color: string, projectId: string) => ({ name, color, projectId });
  const webLabels: Record<string, string> = {};
  for (const l of [mkLabel("frontend", "#6366f1", web.id), mkLabel("backend", "#0ea5e9", web.id), mkLabel("design", "#ec4899", web.id), mkLabel("performance", "#f59e0b", web.id)]) {
    webLabels[l.name] = (await db.label.create({ data: l })).id;
  }
  const mobLabels: Record<string, string> = {};
  for (const l of [mkLabel("ios", "#0ea5e9", mob.id), mkLabel("android", "#22c55e", mob.id), mkLabel("ux", "#ec4899", mob.id)]) {
    mobLabels[l.name] = (await db.label.create({ data: l })).id;
  }
  const opsLabels: Record<string, string> = {};
  for (const l of [mkLabel("infra", "#6366f1", ops.id), mkLabel("security", "#ef4444", ops.id)]) {
    opsLabels[l.name] = (await db.label.create({ data: l })).id;
  }

  // ---------------- Sprints ----------------
  const now = new Date();
  const daysFromNow = (n: number) => new Date(now.getTime() + n * 86400000);
  const sprintWeb = await db.sprint.create({ data: { name: "WEB Sprint 12", state: "ACTIVE", projectId: web.id, goal: "Ship customer portal beta", startDate: daysFromNow(-10), endDate: daysFromNow(4) } });
  const sprintMob = await db.sprint.create({ data: { name: "MOB Sprint 8", state: "ACTIVE", projectId: mob.id, goal: "Push notifications GA", startDate: daysFromNow(-7), endDate: daysFromNow(7) } });

  // ---------------- Tickets ----------------
  type Seed = {
    project: string; type: string; title: string; desc: string;
    status: string; priority: string; reporter?: string; assignee?: string | null;
    due?: number | null; points?: number; sprint?: string; labels?: string[];
    parent?: string; reopened?: number;
  };
  const U: Record<string, string> = { meera: meera.id, rohan: rohan.id, divya: divya.id, rahul: rahul.id, priya: priya.id, arjun: arjun.id, sneha: sneha.id, vikram: vikram.id, neha: neha.id, karan: karan.id };
  const P: Record<string, string> = { web: web.id, mob: mob.id, ops: ops.id };

  const seeds: Seed[] = [
    // ---- WEB project ----
    { project: "web", type: "Epic", title: "Customer Portal Beta", desc: "<h1>Goal</h1><p>Launch the customer portal beta with self-service account management.</p>", status: "In Progress", priority: "High", reporter: "meera", assignee: null, due: 30 },
    { project: "web", type: "Story", title: "Portal login with SSO", desc: "<p>As a customer, I want to sign in with my corporate identity so that I do not need another password.</p><ul><li>Google Workspace</li><li>Microsoft 365</li></ul>", status: "In Progress", priority: "Highest", reporter: "meera", assignee: "rahul", due: 3, points: 8, sprint: sprintWeb.id, labels: ["backend"] },
    { project: "web", type: "Task", title: "Design tokens refresh for portal", desc: "<p>Apply the new design tokens across the portal shell.</p>", status: "Done", priority: "Medium", reporter: "meera", assignee: "priya", due: -5, points: 3, labels: ["design"] },
    { project: "web", type: "Bug", title: "Dashboard charts render blank in Safari 17", desc: "<p>Charts appear empty on Safari 17.x. Suspect canvas sizing race.</p>", status: "In Progress", priority: "High", reporter: "sneha", assignee: "priya", due: 1, points: 5, sprint: sprintWeb.id, labels: ["frontend"] },
    { project: "web", type: "Improvement", title: "Cut landing page LCP below 2s", desc: "<p>Lighthouse shows LCP at 3.4s. Optimize hero image pipeline.</p>", status: "To Do", priority: "Medium", reporter: "meera", assignee: null, due: 10, points: 5, labels: ["performance", "frontend"] },
    { project: "web", type: "Task", title: "Set up staging analytics events", desc: "<p>Wire product analytics events for the beta funnel.</p>", status: "Blocked", priority: "Medium", reporter: "meera", assignee: "rahul", due: -2, points: 3, sprint: sprintWeb.id, labels: ["backend"] },
    { project: "web", type: "Bug", title: "404 for legacy /pricing URLs", desc: "<p>Old pricing links return 404 instead of redirecting.</p>", status: "Reopened", priority: "High", reporter: "neha", assignee: "priya", due: 4, reopened: 2 },
    { project: "web", type: "Story", title: "Billing history page", desc: "<p>Customers should see 24 months of invoices with download links.</p>", status: "Open", priority: "Medium", reporter: "meera", assignee: null, due: 21, points: 8 },
    { project: "web", type: "Sub-task", title: "Write SSO integration tests", desc: "<p>Cover token exchange + logout flows.</p>", status: "In Review", priority: "Medium", reporter: "meera", assignee: "sneha", due: 2 },
    { project: "web", type: "Task", title: "Cookie consent banner audit", desc: "<p>Audit third-party scripts against consent state.</p>", status: "Done", priority: "Low", reporter: "meera", assignee: "arjun", due: -12 },
    { project: "web", type: "Support", title: "Enterprise customer cannot reset password", desc: "<p>Ticket escalated from support: reset emails bouncing for acme.com tenant.</p>", status: "In Progress", priority: "Critical", reporter: "divya", assignee: "rahul", due: 0 },

    // ---- MOB project ----
    { project: "mob", type: "Epic", title: "Push Notifications GA", desc: "<h1>Goal</h1><p>General availability for push notifications on both platforms.</p>", status: "In Progress", priority: "Highest", reporter: "meera", due: 45 },
    { project: "mob", type: "Feature", title: "Deep-link routing for notification taps", desc: "<p>Tapping a notification must open the exact ticket/thread.</p>", status: "In Progress", priority: "High", reporter: "meera", assignee: "arjun", due: 5, points: 8, sprint: sprintMob.id, labels: ["android", "ios"] },
    { project: "mob", type: "Bug", title: "App crashes on Android 14 when camera denied", desc: "<p>Crash report: SecurityException in scanner flow when permission denied twice.</p>", status: "In Progress", priority: "Critical", reporter: "vikram", assignee: "arjun", due: 0, points: 5, sprint: sprintMob.id, labels: ["android"] },
    { project: "mob", type: "Story", title: "Offline mode for ticket list", desc: "<p>Cached list with optimistic status updates, sync on reconnect.</p>", status: "To Do", priority: "High", reporter: "meera", assignee: "priya", due: 14, points: 13, labels: ["ux"] },
    { project: "mob", type: "Improvement", title: "Reduce cold start to <1.5s", desc: "<p>Current p75 cold start is 2.3s on mid-tier Android.</p>", status: "Open", priority: "Medium", reporter: "meera", assignee: null, due: 20, points: 8 },
    { project: "mob", type: "Task", title: "Configure App Store screenshots", desc: "<p>New screenshots for v2.4 release.</p>", status: "Done", priority: "Lowest", reporter: "meera", assignee: "vikram", due: -8, labels: ["ios"] },
    { project: "mob", type: "Bug", title: "Dark mode flicker on iOS launch", desc: "<p>White flash before themed shell renders.</p>", status: "In Review", priority: "Medium", reporter: "priya", assignee: "priya", due: 2, points: 2, labels: ["ios"] },
    { project: "mob", type: "Request", title: "Add Hindi localization", desc: "<p>Translate all strings for India launch.</p>", status: "Open", priority: "Low", reporter: "rohan", assignee: null, due: 60 },
    { project: "mob", type: "Sub-task", title: "Automate push permission prompts test", desc: "<p>Appium suite for permission dialogs.</p>", status: "To Do", priority: "Medium", reporter: "meera", assignee: "vikram", due: 6 },

    // ---- OPS project ----
    { project: "ops", type: "Task", title: "Rotate database credentials Q3", desc: "<p>Quarterly credential rotation per security policy SEC-7.</p>", status: "Open", priority: "High", reporter: "admin", assignee: null, due: 7, labels: ["security"] },
    { project: "ops", type: "Improvement", title: "Nightly backup verification alerts", desc: "<p>Alert when backup restore check fails.</p>", status: "In Progress", priority: "Medium", reporter: "admin", assignee: "vikram", due: 9, labels: ["infra"] },
    { project: "ops", type: "Request", title: "New laptop for support hire", desc: "<p>Procure + image laptop for incoming support specialist.</p>", status: "To Do", priority: "Lowest", reporter: "divya", assignee: "karan", due: 15 },
    { project: "ops", type: "Task", title: "Update runbook: incident escalation", desc: "<p>Rewrite escalation matrix with current on-call rotation.</p>", status: "Done", priority: "Medium", reporter: "divya", assignee: "neha", due: -3 },
    { project: "ops", type: "Bug", title: "SSO group sync misses contractors", desc: "<p>Contractor accounts are skipped during nightly SCIM sync.</p>", status: "Blocked", priority: "High", reporter: "admin", assignee: "vikram", due: -1, labels: ["security"] },
    { project: "ops", type: "Support", title: "Office printer offline - floor 3", desc: "<p>Classic. Printer says network cable unplugged.</p>", status: "Closed", priority: "Lowest", reporter: "karan", assignee: "neha", due: -20 },
    { project: "ops", type: "Task", title: "Decommission legacy file server", desc: "<p>Migrate remaining shares and shut down srv-files-02.</p>", status: "Open", priority: "Medium", reporter: "admin", assignee: null, due: 25, labels: ["infra"] },
    { project: "ops", type: "Request", title: "Access request: analytics dashboard for finance", desc: "<p>Finance needs viewer access to the revenue dashboards.</p>", status: "Resolved", priority: "Low", reporter: "divya", assignee: "neha", due: -6 },
    { project: "ops", type: "Task", title: "Password policy rollout reminder campaign", desc: "<p>Email all users ahead of the 90-day forced reset.</p>", status: "In Review", priority: "Medium", reporter: "admin", assignee: "karan", due: 1 },
    { project: "ops", type: "Bug", title: "Timesheet export missing timezone column", desc: "<p>CSV export drops the timezone column added last release.</p>", status: "Done", priority: "Medium", reporter: "rohan", assignee: "karan", due: -9 },
    { project: "ops", type: "Improvement", title: "Self-service password reset adoption", desc: "<p>Add in-app nudges toward self-service reset.</p>", status: "To Do", priority: "Low", reporter: "divya", assignee: null, due: 18 },
  ];

  let seq = 1000;
  const createdIds: Record<string, string> = {}; // title -> id (for parenting)
  for (const s of seeds) {
    seq += 1;
    const proj = P[s.project];
    const key = `${s.project.toUpperCase()}-${seq}`;
    const dueDate = s.due === undefined || s.due === null ? null : daysFromNow(s.due);
    const createdAt = daysFromNow(-(Math.floor(Math.random() * 20) + 3));
    const t = await db.ticket.create({
      data: {
        key, number: seq, projectId: proj, typeId: types[s.type].id,
        statusId: statuses[s.status].id, priorityId: priorities[s.priority].id,
        title: s.title, description: s.desc,
        reporterId: s.reporter ? U[s.reporter] : null,
        assigneeId: s.assignee ? U[s.assignee] : null,
        sprintId: s.sprint ?? null, parentId: s.parent ? createdIds[s.parent] : null,
        storyPoints: s.points ?? null, dueDate,
        reopenedCount: s.reopened ?? 0,
        createdAt, updatedAt: createdAt,
        labels: s.labels ? { create: s.labels.map((name) => { const pool = s.project === "web" ? webLabels : s.project === "mob" ? mobLabels : opsLabels; return { labelId: pool[name] }; }) } : undefined,
      },
    });
    createdIds[s.title] = t.id;

    await db.ticketHistory.create({
      data: { ticketId: t.id, userId: s.reporter ? U[s.reporter] : admin.id, field: "created", newValue: s.status, createdAt },
    });
  }

  // Parent the SSO story under the portal epic
  await db.ticket.update({
    where: { id: createdIds["Portal login with SSO"] },
    data: { parentId: createdIds["Customer Portal Beta"] },
  });
  await db.ticket.update({
    where: { id: createdIds["Write SSO integration tests"] },
    data: { parentId: createdIds["Portal login with SSO"] },
  });

  // Sync per-project ticket counters with the highest seeded number
  const projects = [web, mob, ops];
  for (const p of projects) {
    const maxNum = await db.ticket.aggregate({
      where: { projectId: p.id },
      _max: { number: true },
    });
    await db.project.update({
      where: { id: p.id },
      data: { nextNumber: (maxNum._max.number ?? 1000) + 50 },
    });
  }

  // ---------------- Comments ----------------
  const c1 = await db.comment.create({
    data: { ticketId: createdIds["Portal login with SSO"], authorId: U.meera, body: "<p>@Rahul please complete the API validation before Friday. Security review is scheduled Monday.</p>" },
  });
  await db.comment.create({
    data: { ticketId: createdIds["Portal login with SSO"], authorId: U.rahul, body: "<p>Token exchange is working against the staging IdP. Finishing logout flow tomorrow.</p>", parentId: c1.id },
  });
  await db.comment.create({
    data: { ticketId: createdIds["App crashes on Android 14 when camera denied"], authorId: U.vikram, body: "<p>Attached the crash stack from Play Console. Reproducible at will.</p>" },
  });
  await db.comment.create({
    data: { ticketId: createdIds["Enterprise customer cannot reset password"], authorId: U.neha, body: "<p>Customer confirmed they receive other emails fine - looks specific to our bounce domain.</p>" },
  });

  // ---------------- Watchers ----------------
  await db.ticketWatcher.createMany({
    data: [
      { ticketId: createdIds["Portal login with SSO"], userId: U.meera },
      { ticketId: createdIds["Portal login with SSO"], userId: U.priya },
      { ticketId: createdIds["App crashes on Android 14 when camera denied"], userId: U.meera },
    ],
  });

  // ---------------- Notifications (sample) ----------------
  await db.notification.createMany({
    data: [
      { userId: U.rahul, actorId: U.meera, type: "TICKET_ASSIGNED", title: "New ticket assigned to you", body: "MOB-1013: App crashes on Android 14 when camera denied", ticketId: createdIds["Enterprise customer cannot reset password"] },
      { userId: U.arjun, actorId: U.meera, type: "MENTION", title: "You were mentioned", body: "Meera Nair mentioned you in Deep-link routing for notification taps", ticketId: createdIds["Deep-link routing for notification taps"] },
      { userId: U.meera, actorId: U.rahul, type: "STATUS_CHANGED", title: "Status changed to In Progress", body: "Rahul moved Portal login with SSO to In Progress", ticketId: createdIds["Portal login with SSO"] },
    ],
  });

  // ---------------- Settings ----------------
  await db.setting.createMany({
    data: [
      { key: "organization", value: { name: "Acme Corporation", domain: "acme.com", supportEmail: "support@acme.com" } },
      { key: "email", value: { provider: "console", from: "Strike <no-reply@strike.local>" } },
      { key: "templates", value: {} },
      { key: "security", value: { passwordMinLength: 10, sessionDays: 7 } },
    ],
  });

  // ---------------- Automation example ----------------
  await db.automationRule.create({
    data: {
      name: "Notify manager for critical open tickets",
      trigger: "FIELD_CHANGED",
      config: { field: "priority", equals: "Critical", alsoStatusCategory: "TODO" },
      actions: [{ type: "NOTIFY_ROLE", role: "Manager" }, { type: "EMAIL_ROLE", role: "Manager", templateKey: "automation_critical" }],
    },
  });

  // ---------------- Audit trail sample ----------------
  await db.auditLog.createMany({
    data: [
      { userId: admin.id, action: "USER_CREATED", entityType: "User", entityId: rahul.id },
      { userId: admin.id, action: "PROJECT_CREATED", entityType: "Project", entityId: web.id, metadata: { key: "WEB" } },
      { userId: meera.id, action: "LOGIN", entityType: "Session" },
    ],
  });

  console.log("Seed complete.");
  console.log("Login accounts (password: Password123!):");
  console.log("  admin@strike.io   - Super Admin");
  console.log("  meera@strike.io   - Manager (Engineering)");
  console.log("  rahul@strike.io   - Employee (Engineering)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
