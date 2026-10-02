import { after } from "next/server";

/**
 * Background job bootstrap.
 *
 * - Vercel/serverless: timers cannot survive between invocations, so work is
 *   done opportunistically after responses (throttled) plus via the scheduled
 *   /api/cron endpoint (vercel.json / GitHub Actions).
 * - Self-hosted/long-running: the first API request starts persistent
 *   intervals (SLA scan every 5 min, email retries every 2 min).
 */

const THROTTLE_MS = 5 * 60_000;
const g = globalThis as unknown as { __strikeLastScan?: number; __strikeWorkers?: boolean };

async function runScan() {
  try {
    const [{ flagBreachedTickets }, { retryPendingEmails }] = await Promise.all([
      import("@/lib/sla"),
      import("@/lib/email/send"),
    ]);
    const [flagged, retried] = await Promise.all([flagBreachedTickets(), retryPendingEmails()]);
    if (flagged > 0 || retried > 0) {
      console.log(`[bg] scan: flagged ${flagged} SLA breach(es), retried ${retried} email(s)`);
    }
  } catch (e) {
    console.error("[bg] scan failed:", e);
  }
}

/** Start persistent intervals on long-running hosts (once per process). */
export function ensureWorkers() {
  if (process.env.VERCEL === "1" || g.__strikeWorkers) return;
  g.__strikeWorkers = true;
  void runScan();
  setInterval(() => void runScan(), 300_000); // SLA + email pass every 5 min
  console.log("[bg] background workers started");
}

/** Piggyback a throttled scan onto any API request (works everywhere). */
export function maybeRunBackgroundScan() {
  ensureWorkers();
  if (process.env.VERCEL !== "1") return;

  // Serverless: each instance is cold-started independently, so the throttle must
  // live in the database - otherwise every cold start re-scans the whole table.
  const last = Number(g.__strikeLastScan ?? 0);
  if (last && Date.now() - last < THROTTLE_MS) return;
  g.__strikeLastScan = Date.now();

  after(async () => {
    try {
      const { db } = await import("@/lib/db");
      const row = await db.setting.findUnique({ where: { key: "bg:lastScanAt" } }).catch(() => null);
      const lastRun = Number((row?.value as { at?: number })?.at ?? 0);
      if (lastRun && Date.now() - lastRun < THROTTLE_MS) return;
      await db.setting.upsert({
        where: { key: "bg:lastScanAt" },
        create: { key: "bg:lastScanAt", value: { at: Date.now() } },
        update: { value: { at: Date.now() } },
      });
    } catch (e) {
      console.error("[bg] throttle check failed:", e);
    }
    await runScan();
  });
}
