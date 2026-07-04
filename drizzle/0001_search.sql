CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce("subject", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("from_email", '') || ' ' || coalesce("from_name", '')), 'B') ||
    setweight(to_tsvector('simple', left(coalesce("text_body", ''), 200000)), 'C')
  ) STORED;
--> statement-breakpoint
CREATE INDEX "messages_search_idx" ON "messages" USING GIN ("search_vector");
--> statement-breakpoint
CREATE INDEX "messages_from_trgm_idx" ON "messages" USING GIN (lower("from_email") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "attachments_filename_trgm_idx" ON "attachments" USING GIN (lower("filename") gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "contacts_name_trgm_idx" ON "contacts" USING GIN ((lower(coalesce("name",'')) || ' ' || lower("email")) gin_trgm_ops);
