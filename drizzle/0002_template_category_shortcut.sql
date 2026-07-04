ALTER TABLE "templates" ADD COLUMN "category" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "shortcut" text;--> statement-breakpoint
CREATE INDEX "templates_shortcut_idx" ON "templates" USING btree (lower("shortcut"));
