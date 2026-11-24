import { test } from "node:test";
import assert from "node:assert/strict";
import { SAMPLE, computeMetrics, parseCsv, toCsv, validateShift, whatsappSummary } from "../src/core/shift.ts";
import { makeShiftAgent } from "../src/agent.ts";
import { scriptedModel, lastToolResults } from "../src/harness/index.ts";

test("OEE = availability × performance × quality = good / target", () => {
  const m = computeMetrics(SAMPLE);
  for (const l of m.lines) {
    assert.ok(Math.abs(l.availability * l.performance * l.quality - l.oee) < 0.002, l.line);
  }
  const l2 = m.lines[1];
  assert.equal(l2.downtimeMin, 92);
  assert.equal(l2.good, 805);
  assert.equal(l2.oee, Math.round((805 / 1200) * 1000) / 1000);
});

test("flags the right lines", () => {
  const m = computeMetrics(SAMPLE);
  const flags = Object.fromEntries(m.lines.map((l) => [l.line, l.flags]));
  assert.deepEqual(flags["Line 1"], []);
  assert.deepEqual(flags["Line 2"].sort(), ["below-target", "high-rejects", "long-downtime"]);
  assert.deepEqual(flags["Line 3"], []);
  assert.deepEqual(flags["Line 4"], ["high-rejects"]); // 31/598 = 5.2%
});

test("totals and top losses", () => {
  const m = computeMetrics(SAMPLE);
  assert.equal(m.totals.target, 4600);
  assert.equal(m.totals.produced, 4101);
  assert.equal(m.topLosses[0].reason, "Breakdown");
  assert.equal(m.topLosses[0].line, "Line 2");
});

test("Hindi and English WhatsApp summaries", () => {
  const m = computeMetrics(SAMPLE);
  const hi = whatsappSummary(SAMPLE, m, "hi");
  assert.match(hi, /शिफ्ट सुबह \(A\)/);
  assert.match(hi, /मशीन खराबी 72 मिनट/);
  assert.match(hi, /अगली शिफ्ट में ध्यान दें: \*Line 2\*/);
  const en = whatsappSummary(SAMPLE, m, "en");
  assert.match(en, /Output: \*4,101\* \/ 4,600 \(89%\)/);
});

test("validation catches impossible numbers", () => {
  const bad = structuredClone(SAMPLE);
  bad.lines[0].rejects = 5000;
  bad.lines[1].downtime.push({ reason: "Power cut", minutes: 600 });
  const p = validateShift(bad);
  assert.equal(p.length, 2);
});

test("CSV round trip and errors", () => {
  assert.deepEqual(parseCsv(toCsv(SAMPLE.lines)), SAMPLE.lines);
  assert.throws(() => parseCsv("L1,Bolt,abc,10,0,"), /must be numbers/);
  assert.throws(() => parseCsv("L1,Bolt,100,90,1,Breakdown"), /Breakdown:25/);
});

test("agent reads metrics through its tool and writes the message", async () => {
  const model = scriptedModel([
    { tools: [{ name: "get_shift_metrics", input: {} }] },
    (req) => ({ text: `Plant OEE ${JSON.parse(lastToolResults(req)[0]).totals.oee}` }),
  ]);
  const agent = makeShiftAgent(model, SAMPLE, "en");
  const r = await agent.run("Write the end-of-shift message.");
  assert.equal(r.output, `Plant OEE ${computeMetrics(SAMPLE).totals.oee}`);
});
