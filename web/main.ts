import { SAMPLE, computeMetrics, parseCsv, toCsv, validateShift, whatsappSummary, type Shift } from "../src/core/shift.ts";
import { makeShiftAgent } from "../src/agent.ts";
import { anthropicModel } from "../src/harness/models/anthropic.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let lang: "hi" | "en" = "hi";
let current: Shift | null = null;
let claudeText: string | null = null;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const n = (x: number) => x.toLocaleString("en-IN");
const FLAG: Record<string, string> = { "below-target": "Below target", "high-rejects": "High rejects", "long-downtime": "Long downtime" };

function load(s: Shift) {
  $<HTMLInputElement>("plant").value = s.plant;
  $<HTMLInputElement>("date").value = s.date;
  $<HTMLSelectElement>("shift").value = s.shift;
  $<HTMLInputElement>("planned").value = String(s.plannedMinutes);
  $<HTMLInputElement>("supervisor").value = s.supervisor;
  $<HTMLTextAreaElement>("csv").value = toCsv(s.lines);
  update();
}

function read(): Shift {
  return {
    plant: $<HTMLInputElement>("plant").value.trim() || "Plant",
    date: $<HTMLInputElement>("date").value,
    shift: $<HTMLSelectElement>("shift").value as Shift["shift"],
    plannedMinutes: Number($<HTMLInputElement>("planned").value),
    supervisor: $<HTMLInputElement>("supervisor").value.trim() || "Supervisor",
    lines: parseCsv($<HTMLTextAreaElement>("csv").value),
  };
}

function update() {
  claudeText = null;
  const err = $("errors");
  let s: Shift;
  try {
    s = read();
  } catch (e) {
    err.hidden = false;
    err.textContent = e instanceof Error ? e.message : String(e);
    return;
  }
  const problems = validateShift(s);
  err.hidden = problems.length === 0;
  err.textContent = problems.join("\n");
  if (problems.length) return;
  current = s;
  const m = computeMetrics(s);
  $("k-oee").textContent = pct(m.totals.oee);
  $("k-out").textContent = `${n(m.totals.produced)} / ${n(m.totals.target)}`;
  $("k-rej").textContent = `${n(m.totals.rejects)} (${m.totals.produced ? ((m.totals.rejects / m.totals.produced) * 100).toFixed(1) : 0}%)`;
  $("k-dt").textContent = `${m.totals.downtimeMin} min`;

  $("lines").replaceChildren(
    ...[...m.lines].sort((a, b) => a.oee - b.oee).map((l) => {
      const el = document.createElement("div");
      el.className = `ln${l.flags.length ? " flag" : ""}`;
      const bars = ([["Availability", l.availability], ["Performance", l.performance], ["Quality", l.quality]] as const)
        .map(([k, v]) => `<span>${k}</span><span class="bar"><i style="width:${Math.min(100, v * 100).toFixed(1)}%"></i></span><span class="num">${pct(v)}</span>`)
        .join("");
      el.innerHTML = `<div class="ln-top"><div><b></b> <span></span></div><span class="ln-oee">OEE ${pct(l.oee)}</span></div><div class="apq">${bars}</div><div class="chips"></div><div class="loss"></div>`;
      el.querySelector("b")!.textContent = l.line;
      el.querySelector(".ln-top span")!.textContent = `${l.product} · ${n(l.produced)}/${n(l.target)}`;
      el.querySelector(".chips")!.replaceChildren(...l.flags.map((f) => Object.assign(document.createElement("span"), { className: "chip", textContent: FLAG[f] ?? f })));
      el.querySelector(".loss")!.textContent = l.topLoss ? `Biggest loss: ${l.topLoss.reason}, ${l.topLoss.minutes} min` : "No downtime logged";
      return el;
    }),
  );
  renderMessage();
}

function renderMessage() {
  if (!current) return;
  const text = claudeText ?? whatsappSummary(current, computeMetrics(current), lang);
  // Show WhatsApp *bold* as bold, safely.
  const b = $("bubble");
  b.replaceChildren();
  for (const part of text.split(/(\*[^*\n]+\*)/)) {
    if (/^\*[^*\n]+\*$/.test(part)) b.append(Object.assign(document.createElement("b"), { textContent: part.slice(1, -1) }));
    else b.append(document.createTextNode(part));
  }
}

function setLang(l: typeof lang) {
  lang = l;
  claudeText = null;
  $("lang-hi").classList.toggle("on", l === "hi");
  $("lang-en").classList.toggle("on", l === "en");
  $("lang-hi").setAttribute("aria-checked", String(l === "hi"));
  $("lang-en").setAttribute("aria-checked", String(l === "en"));
  renderMessage();
}

for (const id of ["plant", "date", "shift", "planned", "supervisor", "csv"]) $(id).addEventListener("input", update);
$("reset").addEventListener("click", () => load(SAMPLE));
$("lang-hi").addEventListener("click", () => setLang("hi"));
$("lang-en").addEventListener("click", () => setLang("en"));
$("copy").addEventListener("click", async () => {
  if (!current) return;
  const text = claudeText ?? whatsappSummary(current, computeMetrics(current), lang);
  try {
    await navigator.clipboard.writeText(text);
    $("copy-status").textContent = "Copied. Paste it in the group.";
  } catch {
    const r = document.createRange();
    r.selectNodeContents($("bubble"));
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(r);
    $("copy-status").textContent = "Selected. Press Ctrl+C or ⌘C to copy.";
  }
});

try { const k = sessionStorage.getItem("sr-key"); if (k) $<HTMLInputElement>("api-key").value = k; } catch {}
$("run").addEventListener("click", async () => {
  if (!current) return;
  const key = $<HTMLInputElement>("api-key").value.trim();
  const st = $("run-status");
  if (!key) { st.textContent = "Paste an Anthropic API key first."; return; }
  try { sessionStorage.setItem("sr-key", key); } catch {}
  $<HTMLButtonElement>("run").disabled = true;
  st.textContent = "Claude is reading the metrics…";
  try {
    const agent = makeShiftAgent(anthropicModel({ apiKey: key, browser: true, maxTokens: 4000 }), current, lang);
    const r = await agent.run("Write the end-of-shift message for the plant WhatsApp group.");
    const err = r.trace.find((e) => e.kind === "error");
    if (r.status === "done" && r.output) {
      claudeText = r.output;
      renderMessage();
      st.textContent = "Written by Claude from the same numbers. Change any input to go back to the standard message.";
    } else {
      st.textContent = err && err.kind === "error" ? (/fetch|network|connection/i.test(err.message) ? "Couldn't reach the Claude API from this page. Open the hosted site if this preview blocks outside requests." : err.message) : `Stopped: ${r.status}.`;
    }
  } finally {
    $<HTMLButtonElement>("run").disabled = false;
  }
});

load(SAMPLE);
