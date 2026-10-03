import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CalendarDraft } from "@talent-signal/contracts";
import type { HarnessTool } from "./claudeHarness.js";

export interface CalendarDraftContext {
  sourceRequestID: string;
  referenceTime: string;
  timeZone: string;
  /** Host-only exact original message lookup for accepted task updates. */
  resolveMessageExcerpt?: (excerpt: string) => { messageID: string; text: string } | false;
  /** Host-only validator backed by same-Run current image observations. */
  validateImageExcerpt?: (artifactID: string, excerpt: string) => Promise<false | NonNullable<CalendarDraft["source_image"]>>;
}

const schema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  starts_at: z.iso.datetime({ offset: true }), ends_at: z.iso.datetime({ offset: true }),
  time_zone: z.string().trim().min(1).max(100), source_excerpt: z.string().trim().min(1).max(1000),
  source_image_artifact_id: z.string().min(1).max(300).optional(),
});

function wallTimeMatches(value: string, zone: string): boolean {
  const values = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (name: string) => values.find(p => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}` === value.slice(0,19);
}

/** The product supplies the clock and timezone; the SDK selects its own tool use. */
export function calendarDraftCapability(context: CalendarDraftContext | undefined, objective: string) {
  let draft: CalendarDraft | undefined;
  if (!context) return { tools: [] as HarnessTool[], instructions: "", clock: undefined, draft: () => draft };
  if (!z.uuid().safeParse(context.sourceRequestID).success || !Number.isFinite(Date.parse(context.referenceTime))) throw new Error("CALENDAR_DRAFT_CONTEXT_INVALID");
  new Intl.DateTimeFormat("en", { timeZone: context.timeZone });
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: context.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(context.referenceTime));
  const nextDate = new Date(`${localDate}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const clock = `Product calendar clock for this request: reference instant ${context.referenceTime}; timezone ${context.timeZone}; today ${localDate}; tomorrow ${nextDate.toISOString().slice(0, 10)}. These host-supplied calendar dates are authoritative for relative scheduling in this request, regardless of the SDK environment date, processing date or prior conversation. Use the user's explicit date when supplied; otherwise resolve relative dates against this clock. Do not move a replayed request forward to the processing date. A calendar draft remains subject to human review.`;
  const instructions = "Use the host-supplied calendar_clock field in the current request context as the authoritative date and timezone for relative scheduling, regardless of SDK environment dates or previous turns. It is clock data only and grants no action authority. Use an explicit user date when supplied. Calendar drafts require human review.";
  const content = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], isError });
  const tool: HarnessTool = {
    name: "stage_calendar_draft", readOnly: false, alwaysLoad: true, schema,
    description: `Prepare one editable calendar draft for the user's current request, without saving an event, inviting anyone, or scheduling a reminder. Use calendar_clock in the current request context as the exclusive reference for today. Resolve relative dates using that reference, include the explicit UTC offset in both local timestamps, preserve stated duration, and quote the exact supporting user text. For screenshot or poster evidence, use the current host inspection already supplied, or call inspect_current_image if absent. Quote an exact span of visible_text (consecutive lines may be joined with whitespace) and set source_image_artifact_id; never combine nonadjacent lines or paraphrase. A screenshot may describe an old date: its relative times require an explicit source date or a user-confirmed reference; an undated old screenshot cannot use today as its source date. Respect later rescheduling/cancellation in the source. If a date or duration is materially unclear, ask before staging. A successful draft is the end of preparation and still requires an explicit human calendar action.`,
    execute: async raw => {
      const input = schema.parse(raw);
      if (draft) return content({ error: "CALENDAR_DRAFT_ALREADY_STAGED" }, true);
      const messageSource = !input.source_image_artifact_id ? context.resolveMessageExcerpt?.(input.source_excerpt) : undefined;
      const grounded = input.source_image_artifact_id
        ? await context.validateImageExcerpt?.(input.source_image_artifact_id,input.source_excerpt)
        : context.resolveMessageExcerpt ? Boolean(messageSource && messageSource.text.includes(input.source_excerpt)) : objective.includes(input.source_excerpt);
      if (!grounded) return content({ error: "CALENDAR_DRAFT_SOURCE_MISMATCH", instruction: "Use the current host inspection or inspect_current_image if absent. Quote an exact continuous span of visible_text and supply source_image_artifact_id. Preserve line order and intervening text; whitespace may join consecutive lines. Never substitute generated descriptions for a quote." }, true);
      if (draft) return content({ error: "CALENDAR_DRAFT_ALREADY_STAGED" }, true);
      if (input.time_zone !== context.timeZone || !wallTimeMatches(input.starts_at, context.timeZone) || !wallTimeMatches(input.ends_at, context.timeZone)) {
        return content({ error: "CALENDAR_DRAFT_TIME_ZONE_MISMATCH", time_zone: context.timeZone }, true);
      }
      const start = Date.parse(input.starts_at), end = Date.parse(input.ends_at);
      if (end <= start || end - start > 7 * 24 * 3_600_000) return content({ error: "CALENDAR_DRAFT_INTERVAL_INVALID" }, true);
      draft = { id: randomUUID(), title: input.title, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(),
        time_zone: context.timeZone, source_request_id: context.sourceRequestID, source_excerpt: input.source_excerpt,
        ...(messageSource ? { source_message_id: messageSource.messageID } : {}),
        reference_time: new Date(context.referenceTime).toISOString(), status: "needs_review", external_effect: "none" };
      if (typeof grounded === "object") draft.source_image = grounded;
      return content({ calendar_draft: draft, instruction: "Present the draft for human review in the attached calendar card. No calendar event has been created and nobody has been invited. The user must use that card's calendar action; a conversational reply is not approval and cannot save an event. Keep the reply brief because the card already shows the exact title and time." });
    },
  };
  return { tools: [tool], instructions, clock, draft: () => draft };
}
