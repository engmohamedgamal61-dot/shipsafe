import { NextResponse } from "next/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

/**
 * GET /api/reviews/:id — returns a single review by id.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}
