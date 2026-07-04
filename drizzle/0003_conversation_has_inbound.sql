ALTER TABLE "conversations" ADD COLUMN "has_inbound" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: the new column defaults every existing row to false, but any
-- conversation that already contains a real inbound message must be marked
-- true, or it would silently vanish from "All Inbox" after this migration.
UPDATE "conversations" c SET "has_inbound" = true
WHERE EXISTS (
  SELECT 1 FROM "messages" m WHERE m.conversation_id = c.id AND m.direction = 'inbound'
);
