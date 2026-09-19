import { NextResponse } from "next/server";
import { markInvoicePaid } from "@/server/billing/writes";

/**
 * POST /api/webhooks/billing — the billing provider's payment-succeeded
 * webhook.
 */
export async function POST(request: Request) {
  const payload = await request.json();

  if (payload.type === "payment.succeeded") {
    await markInvoicePaid(payload.data.invoiceId);
  }

  return NextResponse.json({ ok: true });
}
