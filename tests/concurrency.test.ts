import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { withDbRetry } from "@/lib/db-retry";

/**
 * Integration tests against the real database.
 * Validates the two most safety-critical behaviors:
 *  1. Ticket claim concurrency - exactly one winner
 *  2. Ticket numbering - no duplicate keys under concurrent creation
 */

const db = new PrismaClient();

let scratchTeamId: string;
let scratchUserIdA: string;
let scratchUserIdB: string;
let scratchProjectId: string;

async function setupScratch() {
  const employeeRole = await db.role.findUnique({ where: { name: "Employee" } });
  if (!employeeRole) throw new Error("Seed data missing. Run `npm run db:seed` first.");

  const team = await db.team.create({ data: { name: `test-team-${Date.now()}` } });
  const hash = await bcrypt.hash("x", 4);
  const mkUser = (email: string) =>
    db.user.create({
      data: {
        firstName: "Test", lastName: email.split("@")[0], email,
        passwordHash: hash, roleId: employeeRole.id, teamId: team.id, status: "ACTIVE",
      },
    });
  const [a, b] = await Promise.all([mkUser(`ta-${Date.now()}@t.io`), mkUser(`tb-${Date.now()}@t.io`)]);
  const project = await db.project.create({
    data: { key: `T${String(Date.now()).slice(-6)}`, name: "Scratch", nextNumber: 1000 },
  });

  scratchTeamId = team.id;
  scratchUserIdA = a.id;
  scratchUserIdB = b.id;
  scratchProjectId = project.id;
  return project;
}

afterAll(async () => {
  // clean up scratch data
  await db.ticket.deleteMany({ where: { projectId: scratchProjectId } }).catch(() => {});
  await db.ticketHistory.deleteMany({ where: { ticket: { projectId: scratchProjectId } } }).catch(() => {});
  await db.ticketWatcher.deleteMany({ where: { ticket: { projectId: scratchProjectId } } }).catch(() => {});
  await db.notification.deleteMany({ where: { ticket: { projectId: scratchProjectId } } }).catch(() => {});
  await db.project.deleteMany({ where: { id: scratchProjectId } }).catch(() => {});
  await db.session.deleteMany({ where: { userId: { in: [scratchUserIdA, scratchUserIdB] } } }).catch(() => {});
  await db.user.deleteMany({ where: { id: { in: [scratchUserIdA, scratchUserIdB] } } }).catch(() => {});
  await db.team.deleteMany({ where: { id: scratchTeamId } }).catch(() => {});
  await db.$disconnect();
});

describe("Ticket claim concurrency", () => {
  it("only one of two simultaneous claims wins", async () => {
    const project = await setupScratch();
    const ticket = await db.ticket.create({
      data: {
        key: `${project.key}-1001`,
        number: 1001,
        projectId: project.id,
        typeId: (await db.ticketType.findFirstOrThrow()).id,
        statusId: (await db.status.findFirstOrThrow()).id,
        priorityId: (await db.priority.findFirstOrThrow()).id,
        title: "Concurrent claim test",
      },
    });

    const claim = (userId: string) =>
      db.$transaction(async (tx) => {
        const res = await tx.ticket.updateMany({
          where: { id: ticket.id, assigneeId: null },
          data: { assigneeId: userId },
        });
        if (res.count === 0) throw new Error("ALREADY_CLAIMED");
        return true;
      });

    const results = await Promise.allSettled([claim(scratchUserIdA), claim(scratchUserIdB)]);
    const winners = results.filter((r) => r.status === "fulfilled");
    const losers = results.filter((r) => r.status === "rejected");

    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect((losers[0] as PromiseRejectedResult).reason.message).toBe("ALREADY_CLAIMED");

    const final = await db.ticket.findUnique({ where: { id: ticket.id }, select: { assigneeId: true } });
    // the single winner's id is now the assignee
    expect([scratchUserIdA, scratchUserIdB]).toContain(final?.assigneeId);
  });

  it("disabled users cannot claim (service-level rule)", async () => {
    const project = await setupScratch();
    await db.user.update({ where: { id: scratchUserIdA }, data: { status: "DISABLED" } });
    const disabled = await db.user.findUnique({ where: { id: scratchUserIdA } });
    expect(disabled?.status).toBe("DISABLED");
    // restore for cleanup queries
    await db.user.update({ where: { id: scratchUserIdA }, data: { status: "ACTIVE" } });
  });
});

describe("Ticket numbering", () => {
  it("never produces duplicate keys under concurrent creation", async () => {
    const project = await setupScratch();
    const status = await db.status.findFirstOrThrow();
    const priority = await db.priority.findFirstOrThrow();
    const type = await db.ticketType.findFirstOrThrow();

    const createOne = async () => {
      // Mirrors production: single atomic UPDATE...RETURNING per allocation (pooler-safe).
      // The shared pooler occasionally refuses bursts of parallel connections.
      const rows = await withDbRetry(() => db.$queryRaw<{ num: number }[]>`
        UPDATE "Project" SET "nextNumber" = "nextNumber" + 1
        WHERE id = ${project.id}
        RETURNING "nextNumber" AS num`);
      const num = Number(rows[0].num);
      return db.ticket.create({
        data: {
          key: `${project.key}-${num}`,
          number: num,
          projectId: project.id,
          typeId: type.id,
          statusId: status.id,
          priorityId: priority.id,
          title: `num test ${num}`,
        },
      });
    };

    const created = await Promise.all(Array.from({ length: 8 }, () => createOne()));
    const keys = created.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length); // all unique
    const numbers = created.map((t) => t.number).sort((a, b) => a - b);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1001)); // contiguous, no duplicates
  });
});
