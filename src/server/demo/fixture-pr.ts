import type { ChangedFile } from "@/domain/types";

/**
 * The demo PR: a fictional "add usage-based billing" change with a
 * deliberately planted mix of severities so every reviewer has something
 * real to find. The findings shown in the dashboard are computed from
 * this diff by the actual review engine (`MockAIProvider`) — nothing
 * about the findings themselves is hardcoded.
 */
export const DEMO_PR_TITLE = "Add usage-based billing for metered API calls";
export const DEMO_PR_NUMBER = 482;
export const DEMO_PR_SOURCE_BRANCH = "feat/usage-billing";
export const DEMO_PR_TARGET_BRANCH = "main";
export const DEMO_PR_AUTHOR = "jordan-chen";
export const DEMO_PR_HEAD_SHA = "9f1c2e4a8b3d5f60718293a4b5c6d7e8f9012345";
export const DEMO_PR_BASE_SHA = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";

export const DEMO_CHANGED_FILES: ChangedFile[] = [
  { path: "src/server/billing/usage-tracker.ts", status: "added", additions: 42, deletions: 0 },
  { path: "src/server/billing/invoice.ts", status: "added", additions: 38, deletions: 0 },
  { path: "src/app/api/usage/route.ts", status: "added", additions: 22, deletions: 0 },
  { path: "supabase/migrations/0002_usage_events.sql", status: "added", additions: 14, deletions: 0 },
  { path: "src/lib/config.ts", status: "modified", additions: 2, deletions: 0 },
];

export const DEMO_DIFF_TEXT = `diff --git a/src/server/billing/usage-tracker.ts b/src/server/billing/usage-tracker.ts
new file mode 100644
--- /dev/null
+++ b/src/server/billing/usage-tracker.ts
@@ -0,0 +1,42 @@
+import { db } from "@/server/db";
+
+export async function recordUsage(customerId: string, apiCalls: number) {
+  try {
+    await db.query(\`INSERT INTO usage_events (customer_id, calls) VALUES ('\${customerId}', \${apiCalls})\`);
+  } catch (e) {}
+}
+
+export async function getUsageForBillingPeriod(customerId: string, start: string, end: string) {
+  const rows = await db.query(
+    \`SELECT * FROM usage_events WHERE customer_id = '\${customerId}' AND created_at BETWEEN '\${start}' AND '\${end}'\`,
+  );
+  return rows;
+}
+
+export function calculateOverageCharge(apiCalls: number, includedCalls: number, pricePerCall: number) {
+  const overage = apiCalls - includedCalls;
+  if (overage == 0) {
+    return 0;
+  }
+  return overage * pricePerCall;
+}
+
+export async function syncUsageToStripe(customerId: string) {
+  // TODO: handle partial-period proration correctly
+  const usage = await getUsageForBillingPeriod(customerId, "", "");
+  console.log("syncing usage", customerId, usage);
+  return usage;
+}
diff --git a/src/server/billing/invoice.ts b/src/server/billing/invoice.ts
new file mode 100644
--- /dev/null
+++ b/src/server/billing/invoice.ts
@@ -0,0 +1,38 @@
+const STRIPE_SECRET_KEY = "REPLACE_ME_NOT_A_REAL_SECRET_0000";
+
+export interface InvoiceLine {
+  description: string;
+  amountCents: number;
+}
+
+export function buildInvoice(lines: InvoiceLine[]) {
+  const total = lines.reduce((sum, line) => sum + line.amountCents, 0);
+  return { lines, total };
+}
+
+export function formatInvoiceHtml(customerName: string, notesHtml: string) {
+  return \`<div><h1>Invoice for \${customerName}</h1><div dangerouslySetInnerHTML={{ __html: notesHtml }} /></div>\`;
+}
+
+export function applyDiscount(totalCents: number, discountPercent: number) {
+  if (discountPercent != 0) {
+    return totalCents - Math.round(totalCents * (discountPercent / 100));
+  }
+  return totalCents;
+}
diff --git a/src/app/api/usage/route.ts b/src/app/api/usage/route.ts
new file mode 100644
--- /dev/null
+++ b/src/app/api/usage/route.ts
@@ -0,0 +1,22 @@
+import { NextResponse } from "next/server";
+import { recordUsage } from "@/server/billing/usage-tracker";
+import { SupabaseReviewRepository } from "@/server/repositories/supabase-adapter";
+
+export async function POST(request: Request) {
+  const body = await request.json();
+  await recordUsage(body.customerId, body.apiCalls);
+  return NextResponse.json({ ok: true });
+}
diff --git a/supabase/migrations/0002_usage_events.sql b/supabase/migrations/0002_usage_events.sql
new file mode 100644
--- /dev/null
+++ b/supabase/migrations/0002_usage_events.sql
@@ -0,0 +1,14 @@
+create table public.usage_events (
+  id uuid primary key default gen_random_uuid(),
+  customer_id uuid not null,
+  calls integer not null,
+  created_at timestamptz not null default now()
+);
+
+alter table public.legacy_usage_counters drop column if exists deprecated_total;
+
+alter table public.customers add column billing_plan text not null;
+
+drop table if exists legacy_usage_snapshots;
diff --git a/src/lib/config.ts b/src/lib/config.ts
--- a/src/lib/config.ts
+++ b/src/lib/config.ts
@@ -4,4 +4,6 @@ export const config = {
   appName: "ShipSafe",
   supportEmail: "support@shipsafe.dev",
+  billingEnabled: true,
+  overagePricePerCallCents: 2,
 };
`;
