CREATE TYPE "public"."connected_account_provider" AS ENUM('microsoft');--> statement-breakpoint
CREATE TYPE "public"."connected_account_status" AS ENUM('active', 'reauth_required', 'error');--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "connected_account_provider" DEFAULT 'microsoft' NOT NULL,
	"email_address" text NOT NULL,
	"display_name" text,
	"status" "connected_account_status" DEFAULT 'active' NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"delta_link" text,
	"signature_id" uuid,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "connected_account_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "connected_account_id" uuid;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_signature_id_signatures_id_fk" FOREIGN KEY ("signature_id") REFERENCES "public"."signatures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connected_accounts_email_uq" ON "connected_accounts" USING btree (lower("email_address"));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;