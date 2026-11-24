import { Agent, defineTool, type ModelClient, type TraceEvent } from "./harness/index.ts";
import { THRESHOLDS, computeMetrics, validateShift, type Shift } from "./core/shift.ts";

export const SYSTEM = `You write the end-of-shift message a production supervisor posts in a factory's WhatsApp group.

Call get_shift_metrics first. Every number you write must come from it; never estimate or round differently.

Write for people reading on a phone on the shop floor:
- First line: plant, date, shift.
- Overall output vs target, rejects, downtime and plant OEE.
- One line per production line, worst first, with the main reason it lost time.
- Then 2 or 3 concrete actions for the next shift, each tied to a specific line and loss (e.g. "Line 2: maintenance to check the hydraulic press before start-up, it lost 72 minutes to a breakdown").
Use WhatsApp formatting (*bold*) sparingly. Keep it under 180 words. Write in the language asked for; for Hindi use Devanagari, keeping line names, product names and "OEE" in English as factories do.`;

export function makeShiftAgent(model: ModelClient, shift: Shift, lang: "hi" | "en", onEvent?: (e: TraceEvent) => void) {
  const getMetrics = defineTool<Record<string, never>>({
    name: "get_shift_metrics",
    description: `Metrics for this shift: per line target, produced, good, rejects, downtime by reason, availability, performance, quality, OEE and flags. Flags use these limits: attainment below ${THRESHOLDS.attainment * 100}%, rejects above ${THRESHOLDS.rejectRate * 100}%, downtime over ${THRESHOLDS.downtimeMin} min.`,
    input: { type: "object", properties: {} },
    run: () => {
      const problems = validateShift(shift);
      if (problems.length) throw new Error(`The shift data has problems; tell the supervisor instead of writing a summary:\n- ${problems.join("\n- ")}`);
      const m = computeMetrics(shift);
      return { plant: shift.plant, date: shift.date, shift: shift.shift, planned_minutes: shift.plannedMinutes, supervisor: shift.supervisor, ...m, downtime_by_line: shift.lines.map((l) => ({ line: l.line, downtime: l.downtime })) };
    },
  });
  return new Agent({
    model,
    system: SYSTEM + `\n\nLanguage for this message: ${lang === "hi" ? "Hindi" : "English"}.`,
    tools: [getMetrics],
    limits: { maxSteps: 4 },
    onEvent,
  });
}
