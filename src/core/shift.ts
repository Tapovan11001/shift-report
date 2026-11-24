// Shift data in, metrics and a WhatsApp summary out. All plain code.

export interface Downtime {
  reason: string;
  minutes: number;
}

export interface LineInput {
  line: string;
  product: string;
  /** Pieces the line should make in the planned time at its rated speed. */
  target: number;
  /** Pieces actually made, good and bad. */
  produced: number;
  rejects: number;
  downtime: Downtime[];
}

export interface Shift {
  plant: string;
  date: string; // YYYY-MM-DD
  shift: "A" | "B" | "C";
  plannedMinutes: number;
  supervisor: string;
  lines: LineInput[];
}

export interface LineMetrics {
  line: string;
  product: string;
  target: number;
  produced: number;
  good: number;
  rejects: number;
  downtimeMin: number;
  topLoss: Downtime | null;
  /** Share of planned time the line was running. */
  availability: number;
  /** Speed while running, vs. rated speed. */
  performance: number;
  /** Good pieces / all pieces. */
  quality: number;
  /** availability × performance × quality = good / target. */
  oee: number;
  attainment: number;
  flags: string[];
}

export interface ShiftMetrics {
  lines: LineMetrics[];
  totals: { target: number; produced: number; good: number; rejects: number; downtimeMin: number; oee: number; attainment: number };
  topLosses: (Downtime & { line: string })[];
}

export const THRESHOLDS = { attainment: 0.85, rejectRate: 0.03, downtimeMin: 30 };

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function validateShift(s: Shift): string[] {
  const p: string[] = [];
  if (s.plannedMinutes <= 0) p.push("Planned minutes must be more than 0.");
  s.lines.forEach((l) => {
    if (l.target <= 0) p.push(`${l.line}: target must be more than 0.`);
    if (l.produced < 0 || l.rejects < 0) p.push(`${l.line}: counts can't be negative.`);
    if (l.rejects > l.produced) p.push(`${l.line}: rejects (${l.rejects}) are more than pieces produced (${l.produced}).`);
    const dt = l.downtime.reduce((a, d) => a + d.minutes, 0);
    if (dt > s.plannedMinutes) p.push(`${l.line}: downtime (${dt} min) is longer than the shift (${s.plannedMinutes} min).`);
  });
  return p;
}

export function computeMetrics(s: Shift): ShiftMetrics {
  const lines = s.lines.map((l): LineMetrics => {
    const downtimeMin = l.downtime.reduce((a, d) => a + d.minutes, 0);
    const good = l.produced - l.rejects;
    const availability = clamp((s.plannedMinutes - downtimeMin) / s.plannedMinutes);
    const performance = availability > 0 ? l.produced / (l.target * availability) : 0;
    const quality = l.produced > 0 ? good / l.produced : 0;
    const oee = l.target > 0 ? good / l.target : 0;
    const attainment = l.target > 0 ? l.produced / l.target : 0;
    const topLoss = [...l.downtime].sort((a, b) => b.minutes - a.minutes)[0] ?? null;
    const flags: string[] = [];
    if (attainment < THRESHOLDS.attainment) flags.push("below-target");
    if (l.produced > 0 && l.rejects / l.produced > THRESHOLDS.rejectRate) flags.push("high-rejects");
    if (downtimeMin > THRESHOLDS.downtimeMin) flags.push("long-downtime");
    return {
      line: l.line, product: l.product, target: l.target, produced: l.produced, good, rejects: l.rejects, downtimeMin, topLoss,
      availability: r3(availability), performance: r3(performance), quality: r3(quality), oee: r3(oee), attainment: r3(attainment), flags,
    };
  });
  const sum = (k: "target" | "produced" | "good" | "rejects" | "downtimeMin") => lines.reduce((a, l) => a + l[k], 0);
  const target = sum("target"), good = sum("good"), produced = sum("produced");
  const topLosses = s.lines
    .flatMap((l) => l.downtime.map((d) => ({ ...d, line: l.line })))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 3);
  return {
    lines,
    totals: { target, produced, good, rejects: sum("rejects"), downtimeMin: sum("downtimeMin"), oee: target ? r3(good / target) : 0, attainment: target ? r3(produced / target) : 0 },
    topLosses,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const n = (x: number) => x.toLocaleString("en-IN");
const shiftHi: Record<Shift["shift"], string> = { A: "सुबह (A)", B: "दोपहर (B)", C: "रात (C)" };
const reasonHi: Record<string, string> = {
  "Changeover": "चेंजओवर", "Breakdown": "मशीन खराबी", "Material shortage": "माल की कमी", "Power cut": "बिजली कटौती",
  "No operator": "ऑपरेटर नहीं", "Quality hold": "क्वालिटी होल्ड", "Tool change": "टूल बदलना", "Planned maintenance": "नियोजित मेंटेनेंस",
};
const tr = (reason: string) => reasonHi[reason] ?? reason;

/** The message a supervisor would post in the plant's WhatsApp group. *bold* is WhatsApp formatting. */
export function whatsappSummary(s: Shift, m: ShiftMetrics, lang: "hi" | "en" = "hi"): string {
  const t = m.totals;
  const byOee = [...m.lines].sort((a, b) => a.oee - b.oee); // worst line first
  const worst = byOee[0];
  if (lang === "hi") {
    const rows = byOee.map((l) => {
      const mark = l.flags.length ? "🔴" : "🟢";
      const loss = l.topLoss ? `, ${tr(l.topLoss.reason)} ${l.topLoss.minutes} मिनट` : "";
      return `${mark} *${l.line}* (${l.product}): ${n(l.produced)}/${n(l.target)} पीस, रिजेक्ट ${n(l.rejects)}${loss}. OEE ${pct(l.oee)}`;
    });
    const losses = m.topLosses.map((d, i) => `${i + 1}. ${d.line}: ${tr(d.reason)} (${d.minutes} मिनट)`);
    return [
      `*${s.plant} | ${s.date} | शिफ्ट ${shiftHi[s.shift]}*`,
      `कुल उत्पादन: *${n(t.produced)}* / ${n(t.target)} (${pct(t.attainment)})`,
      `अच्छे पीस: ${n(t.good)} | रिजेक्ट: ${n(t.rejects)} | डाउनटाइम: ${t.downtimeMin} मिनट`,
      `प्लांट OEE: *${pct(t.oee)}*`,
      "",
      ...rows,
      "",
      "*सबसे बड़े नुकसान:*",
      ...losses,
      "",
      worst && worst.flags.length ? `अगली शिफ्ट में ध्यान दें: *${worst.line}*` : "सभी लाइनें टारगेट के पास रहीं। 👍",
      `— ${s.supervisor}`,
    ].join("\n");
  }
  const rows = byOee.map((l) => {
    const mark = l.flags.length ? "🔴" : "🟢";
    const loss = l.topLoss ? `, ${l.topLoss.reason.toLowerCase()} ${l.topLoss.minutes} min` : "";
    return `${mark} *${l.line}* (${l.product}): ${n(l.produced)}/${n(l.target)} pcs, ${n(l.rejects)} rejects${loss}. OEE ${pct(l.oee)}`;
  });
  const losses = m.topLosses.map((d, i) => `${i + 1}. ${d.line}: ${d.reason} (${d.minutes} min)`);
  return [
    `*${s.plant} | ${s.date} | Shift ${s.shift}*`,
    `Output: *${n(t.produced)}* / ${n(t.target)} (${pct(t.attainment)})`,
    `Good: ${n(t.good)} | Rejects: ${n(t.rejects)} | Downtime: ${t.downtimeMin} min`,
    `Plant OEE: *${pct(t.oee)}*`,
    "",
    ...rows,
    "",
    "*Biggest losses:*",
    ...losses,
    "",
    worst && worst.flags.length ? `Focus next shift: *${worst.line}*` : "All lines close to target. 👍",
    `— ${s.supervisor}`,
  ].join("\n");
}

/** Parse "line,product,target,produced,rejects,downtime" CSV. Downtime is "Reason:min; Reason:min". */
export function parseCsv(csv: string): LineInput[] {
  const rows = csv.trim().split(/\r?\n/).filter(Boolean);
  const start = /target/i.test(rows[0] ?? "") ? 1 : 0;
  return rows.slice(start).map((row, i) => {
    const [line, product, target, produced, rejects, downtime = ""] = row.split(",").map((x) => x.trim());
    const nums = [target, produced, rejects].map(Number);
    if (nums.some((x) => !Number.isFinite(x))) throw new Error(`Row ${i + 1 + start}: target, produced and rejects must be numbers.`);
    return {
      line, product, target: nums[0], produced: nums[1], rejects: nums[2],
      downtime: downtime.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
        const [reason, min] = d.split(":").map((x) => x.trim());
        const minutes = Number(min);
        if (!reason || !Number.isFinite(minutes)) throw new Error(`Row ${i + 1 + start}: downtime should look like "Breakdown:25".`);
        return { reason, minutes };
      }),
    };
  });
}

export function toCsv(lines: LineInput[]): string {
  return ["line,product,target,produced,rejects,downtime", ...lines.map((l) => [l.line, l.product, l.target, l.produced, l.rejects, l.downtime.map((d) => `${d.reason}:${d.minutes}`).join("; ")].join(","))].join("\n");
}

// Fictional plant. Numbers are realistic for a small auto-components unit.
export const SAMPLE: Shift = {
  plant: "Shakti Auto Components, Pune",
  date: "2026-11-24",
  shift: "A",
  plannedMinutes: 480,
  supervisor: "Ramesh (Shift A)",
  lines: [
    { line: "Line 1", product: "Brake drum", target: 960, produced: 912, rejects: 14, downtime: [{ reason: "Changeover", minutes: 18 }] },
    { line: "Line 2", product: "Hub flange", target: 1200, produced: 846, rejects: 41, downtime: [{ reason: "Breakdown", minutes: 72 }, { reason: "Material shortage", minutes: 20 }] },
    { line: "Line 3", product: "Bracket", target: 1800, produced: 1745, rejects: 22, downtime: [{ reason: "Tool change", minutes: 10 }] },
    { line: "Line 4", product: "Shaft", target: 640, produced: 598, rejects: 31, downtime: [{ reason: "Quality hold", minutes: 25 }] },
  ],
};
