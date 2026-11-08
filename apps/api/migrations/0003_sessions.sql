CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"rescheduled_from" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_rescheduled_from_key" UNIQUE("rescheduled_from"),
	CONSTRAINT "sessions_status_check" CHECK ("sessions"."status" in ('booked', 'cancelled')),
	CONSTRAINT "sessions_cancel_reason_check" CHECK ("sessions"."cancel_reason" in ('member', 'professional', 'rescheduled')),
	CONSTRAINT "sessions_fifty_minutes" CHECK ("sessions"."ends_at" - "sessions"."starts_at" = interval '50 minutes'),
	CONSTRAINT "sessions_not_self" CHECK ("sessions"."member_id" <> "sessions"."professional_id"),
	CONSTRAINT "sessions_cancelled_at_matches_status" CHECK (("sessions"."status" = 'cancelled') = ("sessions"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_rescheduled_from_sessions_id_fk" FOREIGN KEY ("rescheduled_from") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;