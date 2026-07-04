/**
 * Dependency-light migration runner (works in the standalone Docker image
 * where drizzle-kit isn't shipped). Applies drizzle/*.sql in journal order,
 * tracking applied migrations in _mh_migrations.
 */
import postgres from "postgres";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url =
  process.env.DATABASE_URL ?? "postgres://mailhub:mailhub@localhost:5448/mailhub";

const sql = postgres(url, { max: 1, onnotice: () => {} });

async function main() {
  const journal = JSON.parse(
    readFileSync(join(root, "drizzle", "meta", "_journal.json"), "utf8")
  );

  await sql`CREATE TABLE IF NOT EXISTS _mh_migrations (
    tag text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;

  const applied = new Set(
    (await sql`SELECT tag FROM _mh_migrations`).map((r) => r.tag)
  );

  for (const entry of journal.entries) {
    if (applied.has(entry.tag)) continue;
    const file = readFileSync(join(root, "drizzle", `${entry.tag}.sql`), "utf8");
    const statements = file
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    console.log(`Applying ${entry.tag} (${statements.length} statements)…`);
    await sql.begin(async (tx) => {
      for (const stmt of statements) {
        await tx.unsafe(stmt);
      }
      await tx`INSERT INTO _mh_migrations (tag) VALUES (${entry.tag})`;
    });
  }

  console.log("Migrations up to date.");
  await sql.end();
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await sql.end();
  process.exit(1);
});
