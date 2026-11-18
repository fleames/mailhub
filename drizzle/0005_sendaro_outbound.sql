ALTER TABLE "domains" ADD COLUMN "outbound_provider" text DEFAULT 'resend' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "outbound_provider" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "provider_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
