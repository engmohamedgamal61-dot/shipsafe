import { Pool } from "pg";

const pool = new Pool();

/**
 * Search connected repositories by full name substring, e.g. "acme/".
 */
export async function searchRepositoriesByName(fullNameQuery: string) {
  const sql = `SELECT * FROM repositories WHERE full_name LIKE '%${fullNameQuery}%'`;
  const result = await pool.query(sql);
  return result.rows;
}
