import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Search the caller's own connected repositories by full name substring.
 * Reads like it could be building a raw query, but `.ilike()` is a
 * parameterized query-builder method — the client library, not this
 * function, is responsible for escaping `fullNameQuery` before it ever
 * reaches Postgres.
 */
export async function searchRepositoriesByName(fullNameQuery: string) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("repositories")
    .select("*")
    .ilike("full_name", `%${fullNameQuery}%`);
  return data ?? [];
}
