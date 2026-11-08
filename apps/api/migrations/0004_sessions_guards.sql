-- Hand-written: Drizzle cannot express exclusion constraints or triggers.
-- A professional never has two booked sessions whose times overlap. '[)' ranges: back-to-back is fine.
-- Only booked rows count, so cancelling a session frees its time without deleting it.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_no_professional_overlap" EXCLUDE USING gist
  ("professional_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("status" = 'booked');
--> statement-breakpoint
-- The same rule for the member, across all professionals.
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_no_member_overlap" EXCLUDE USING gist
  ("member_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("status" = 'booked');
--> statement-breakpoint
-- No new session may start in the past, judged by the database's own clock.
-- A trigger rather than a CHECK: a CHECK with now() would fail on old rows when a dump is restored.
CREATE FUNCTION "sessions_reject_past"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.starts_at <= now() THEN
    RAISE EXCEPTION 'session starts in the past' USING ERRCODE = '23514', CONSTRAINT = 'sessions_not_in_past';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "sessions_not_in_past" BEFORE INSERT ON "sessions"
  FOR EACH ROW EXECUTE FUNCTION "sessions_reject_past"();
