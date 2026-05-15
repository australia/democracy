CREATE TYPE "public"."chamber_kind" AS ENUM('lower', 'upper', 'unicameral');--> statement-breakpoint
CREATE TYPE "public"."channel_kind" AS ENUM('email', 'form');--> statement-breakpoint
CREATE TYPE "public"."contact_form_kind" AS ENUM('aph', 'sitecore', 'drupal', 'custom', 'none');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_code" AS ENUM('federal', 'nsw', 'vic', 'qld', 'wa', 'sa', 'tas', 'act', 'nt');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('pending', 'approved', 'rejected', 'auto_approved');--> statement-breakpoint
CREATE TYPE "public"."state_code" AS ENUM('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chambers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction_id" uuid NOT NULL,
	"kind" "chamber_kind" NOT NULL,
	"name" text NOT NULL,
	"members_per_voter" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"channel" "channel_kind" NOT NULL,
	"transport_id" text,
	"response_code" integer,
	"response_body" text,
	"success" boolean NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "electorates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chamber_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"geom" geography(MultiPolygon, 4326) NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"source_rev" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jurisdictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "jurisdiction_code" NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jurisdictions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"rep_id" uuid NOT NULL,
	"intended_channel" "channel_kind" NOT NULL,
	"status" "delivery_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"body_simhash" text,
	"moderation_status" "moderation_status" DEFAULT 'auto_approved' NOT NULL,
	"moderation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chamber_id" uuid NOT NULL,
	"electorate_id" uuid,
	"state_code" "state_code",
	"external_id" text,
	"full_name" text NOT NULL,
	"given" text,
	"family" text,
	"honorific" text,
	"party" text,
	"photo_url" text,
	"profile_url" text,
	"primary_email" varchar(254),
	"alt_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contact_form_url" text,
	"contact_form_kind" "contact_form_kind" DEFAULT 'none' NOT NULL,
	"has_known_bounce" boolean DEFAULT false NOT NULL,
	"active_as_of" timestamp with time zone DEFAULT now() NOT NULL,
	"inactive_as_of" timestamp with time zone,
	"last_verified" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roster_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"jurisdiction" "jurisdiction_code" NOT NULL,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rows_raw" jsonb NOT NULL,
	"diff" jsonb,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"email_verified_at" timestamp with time zone,
	"given" text,
	"family" text,
	"postal_address" text,
	"postcode" varchar(4),
	"address_lat" text,
	"address_lng" text,
	"address_verified_at" timestamp with time zone,
	"federal_lower_electorate_id" uuid,
	"state_lower_electorate_id" uuid,
	"state_upper_electorate_id" uuid,
	"address_state_code" "state_code",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chambers" ADD CONSTRAINT "chambers_jurisdiction_id_jurisdictions_id_fk" FOREIGN KEY ("jurisdiction_id") REFERENCES "public"."jurisdictions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_recipient_id_message_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."message_recipients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "electorates" ADD CONSTRAINT "electorates_chamber_id_chambers_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."chambers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_recipients" ADD CONSTRAINT "message_recipients_rep_id_reps_id_fk" FOREIGN KEY ("rep_id") REFERENCES "public"."reps"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reps" ADD CONSTRAINT "reps_chamber_id_chambers_id_fk" FOREIGN KEY ("chamber_id") REFERENCES "public"."chambers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reps" ADD CONSTRAINT "reps_electorate_id_electorates_id_fk" FOREIGN KEY ("electorate_id") REFERENCES "public"."electorates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_federal_lower_electorate_id_electorates_id_fk" FOREIGN KEY ("federal_lower_electorate_id") REFERENCES "public"."electorates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_state_lower_electorate_id_electorates_id_fk" FOREIGN KEY ("state_lower_electorate_id") REFERENCES "public"."electorates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_state_upper_electorate_id_electorates_id_fk" FOREIGN KEY ("state_upper_electorate_id") REFERENCES "public"."electorates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "auth_tokens_token_hash_uq" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chambers_jurisdiction_kind_uq" ON "chambers" USING btree ("jurisdiction_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "electorates_chamber_code_validto_uq" ON "electorates" USING btree ("chamber_id","code","valid_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "electorates_geom_gix" ON "electorates" USING gist ("geom");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_recipients_message_rep_uq" ON "message_recipients" USING btree ("message_id","rep_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_recipients_status_idx" ON "message_recipients" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reps_chamber_external_uq" ON "reps" USING btree ("chamber_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reps_electorate_idx" ON "reps" USING btree ("electorate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reps_state_idx" ON "reps" USING btree ("state_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_verified_idx" ON "users" USING btree ("email_verified_at");