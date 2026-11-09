import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOutletContext } from "react-router";
import { api } from "./api.ts";
import type { Me } from "./auth.ts";
import { noticeLabel, zoneOption } from "./format.ts";
import { BellIcon, Bone, Button, Callout, Card, CheckIcon, ClockIcon, inputClass, Loading, PageHeader, SwitchTrack, Zone } from "./ui.tsx";

type BookingSettings = { minNoticeMinutes: number };

// The only values the API accepts.
const NOTICE_OPTIONS = [0, 60, 120, 240, 720, 1440, 2880];
const noticeOption = (m: number) => (m === 0 ? "No minimum" : noticeLabel(m));

export function useBookingSettings() {
  return useQuery({ queryKey: ["booking-settings"], queryFn: () => api<BookingSettings>("/api/booking-settings") });
}

export function Settings() {
  const me = useOutletContext<Me>();
  const queryClient = useQueryClient();

  // Optimistic: the switch flips at once; if the server refuses, the old value comes back with the server's message.
  const emails = useMutation({
    mutationFn: (emailReminders: boolean) =>
      api<Me>("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailReminders }),
      }),
    onMutate: async (emailReminders) => {
      await queryClient.cancelQueries({ queryKey: ["me"] });
      const before = queryClient.getQueryData<Me>(["me"]);
      if (before) queryClient.setQueryData<Me>(["me"], { ...before, emailReminders });
      return { before };
    },
    onError: (_error, _value, context) => {
      if (context?.before) queryClient.setQueryData(["me"], context.before);
    },
    onSuccess: (updated) => queryClient.setQueryData(["me"], updated),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <Card>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-900">
            <BellIcon className="size-5 text-brand-700" />
            Reminders
          </h2>
          <p className="mt-2 text-sm text-stone-700">In-app reminders are always on: 24 hours and 1 hour before each session.</p>

          <div className="mt-5 flex items-start justify-between gap-4 border-t border-stone-100 pt-5">
            <div className="min-w-0">
              <p id="email-reminders-label" className="font-medium text-stone-900">
                Email me reminders too
              </p>
              <p id="email-reminders-help" className="mt-1 text-sm text-stone-600">
                Emails only say that a session is coming up and when, never who it is with.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={me.emailReminders}
              aria-labelledby="email-reminders-label"
              aria-describedby="email-reminders-help"
              // Not disabled while saving (that would drop keyboard focus); a second press just waits for the first.
              onClick={() => !emails.isPending && emails.mutate(!me.emailReminders)}
              className="group inline-flex size-11 shrink-0 items-center justify-center rounded-full"
            >
              <SwitchTrack on={me.emailReminders} />
            </button>
          </div>

          {emails.isError && (
            <div className="mt-4">
              <Callout>Could not change email reminders: {emails.error.message}</Callout>
            </div>
          )}
          <div className="mt-4">
            <Callout tone="info">
              In this demo, emails go to a local test inbox (Mailpit) at{" "}
              <a href="http://localhost:8025" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                http://localhost:8025
              </a>
              , not to real addresses.
            </Callout>
          </div>
        </Card>

        {me.role === "professional" && <BookingNoticeCard />}

        <Card>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-900">
            <ClockIcon className="size-5 text-brand-700" />
            Timezone
          </h2>
          <p className="mt-2 font-medium text-stone-900">
            <Zone zone={me.timezone} long />
          </p>
          <p className="mt-1 text-sm text-stone-600">{zoneOption(me.timezone)}. Set at sign-up; every time in the app is shown in this zone.</p>
        </Card>
      </div>
    </div>
  );
}

function BookingNoticeCard() {
  const saved = useBookingSettings();
  return (
    <Card>
      <h2 id="booking-notice" className="flex items-center gap-2 text-lg font-semibold text-stone-900">
        <ClockIcon className="size-5 text-brand-700" />
        Booking notice
      </h2>
      <p className="mt-2 text-sm text-stone-700">Members can't book a session that starts sooner than this.</p>
      {saved.isPending && (
        <Loading className="mt-4">
          <Bone className="h-11" />
        </Loading>
      )}
      {saved.isError && (
        <div className="mt-4">
          <Callout>Could not load your booking notice: {saved.error.message}</Callout>
        </div>
      )}
      {saved.data && <NoticeForm initial={saved.data.minNoticeMinutes} />}
    </Card>
  );
}

// Saved with a button rather than on change: arrowing through a select must not save every value on the way.
function NoticeForm({ initial }: { initial: number }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(initial);
  const save = useMutation({
    mutationFn: (minNoticeMinutes: number) =>
      api<BookingSettings>("/api/booking-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minNoticeMinutes }),
      }),
    onSuccess: (updated) => queryClient.setQueryData(["booking-settings"], updated),
  });
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(value);
      }}
    >
      <label htmlFor="min-notice" className="block text-sm font-medium text-stone-700">
        Minimum notice
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <select
          id="min-notice"
          value={value}
          onChange={(e) => {
            setValue(Number(e.target.value));
            save.reset();
          }}
          className={`${inputClass} w-auto min-w-0 flex-1 sm:max-w-56`}
        >
          {NOTICE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {noticeOption(m)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {save.isSuccess && (
          <p role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 motion-safe:animate-fade">
            <CheckIcon className="size-4" />
            Saved
          </p>
        )}
      </div>
      {save.isError && <Callout>Could not save the booking notice: {save.error.message}</Callout>}
    </form>
  );
}
