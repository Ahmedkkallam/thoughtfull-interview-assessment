CREATE TABLE "working_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	CONSTRAINT "working_hours_professional_weekday_start_key" UNIQUE("professional_id","weekday","start_time"),
	CONSTRAINT "working_hours_weekday_check" CHECK ("working_hours"."weekday" between 1 and 7),
	CONSTRAINT "working_hours_end_after_start" CHECK ("working_hours"."end_time" > "working_hours"."start_time")
);
--> statement-breakpoint
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;