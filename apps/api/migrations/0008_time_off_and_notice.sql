CREATE TABLE "blocked_dates" (
	"professional_id" uuid NOT NULL,
	"day" date NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_dates_pkey" PRIMARY KEY("professional_id","day"),
	CONSTRAINT "blocked_dates_reason_length" CHECK (char_length("blocked_dates"."reason") <= 80)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "min_notice_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "blocked_dates" ADD CONSTRAINT "blocked_dates_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_min_notice_minutes_check" CHECK ("users"."min_notice_minutes" in (0, 60, 120, 240, 720, 1440, 2880));