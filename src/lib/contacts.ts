import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { Address } from "@/db/schema";

/**
 * Auto-build the address book: upsert a contact whenever we exchange mail
 * with an address, keeping counters and last-contacted fresh. Raw SQL because
 * the unique index is on lower(email), which drizzle's typed onConflict can't target.
 */
export async function upsertContact(
  addr: Address,
  opts: { newConversation: boolean; contacted: boolean }
) {
  const email = addr.email.trim().toLowerCase();
  if (!email || !email.includes("@") || email.length > 320) return;
  const name = (addr.name ?? "").trim() || null;

  await db.execute(sql`
    INSERT INTO contacts (email, name, last_contacted_at, conversation_count, message_count)
    VALUES (
      ${email},
      ${name},
      ${opts.contacted ? new Date() : null},
      ${opts.newConversation ? 1 : 0},
      1
    )
    ON CONFLICT (lower(email)) DO UPDATE SET
      name = COALESCE(NULLIF(contacts.name, ''), EXCLUDED.name),
      last_contacted_at = GREATEST(
        COALESCE(contacts.last_contacted_at, 'epoch'::timestamptz),
        COALESCE(EXCLUDED.last_contacted_at, 'epoch'::timestamptz)
      ),
      conversation_count = contacts.conversation_count + ${opts.newConversation ? 1 : 0},
      message_count = contacts.message_count + 1
  `);
}
