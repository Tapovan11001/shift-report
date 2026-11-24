# Shift Report

Turns a factory's line counts into an end-of-shift summary for the plant's WhatsApp group, in Hindi or English, with OEE per line and the biggest losses called out.

**Live:** {{live-url}}

## How it works in 100 words

At the end of every shift, a factory supervisor has to tell everyone how it went. Shift Report makes that a two-minute job. You type what each production line was supposed to make, what it actually made, how many pieces were rejected, and why it stopped (a breakdown, a changeover, no material). It works out each line's OEE, a standard score that combines time running, speed and quality, and flags the lines that fell short. Then it writes a WhatsApp message for the plant group, in Hindi or English, worst line first. Claude can rewrite it with action items for the next shift, using the same numbers.

_Created by Aarav Makhija._

## Why

In most Indian factories the end-of-shift report is a supervisor doing arithmetic on paper and typing a long WhatsApp message. It takes time, numbers get rounded differently every day, and the useful part (which line lost the most time, and why) is buried. Shift Report computes the numbers the same way every time and puts the worst line first.

## What it does

- Reads target, produced, rejects and downtime-by-reason for each line (form or CSV).
- Checks the input: rejects can't exceed production, downtime can't exceed the shift.
- Computes availability, performance, quality and OEE per line and for the plant.
- Flags lines under 85% of target, over 3% rejects or over 30 minutes down.
- Writes the WhatsApp message in Hindi (Devanagari) or English, with the top three losses.
- Optional: Claude rewrites it with two or three concrete actions for the next shift. It reads the numbers through a tool, so it can't make them up.

## OEE, quickly

OEE (overall equipment effectiveness) = availability × performance × quality.

- Availability: share of the planned time the line was running.
- Performance: how fast it ran while running, against its rated speed.
- Quality: good pieces out of all pieces.

With target = rated speed × planned time, OEE works out to good pieces ÷ target. The tests check both forms agree.

## Run it

```bash
npm install
npm test        # 7 tests: metrics, flags, both languages, validation, CSV, agent
npm run dev     # localhost:5173
```

## Layout

| Path | What's in it |
|---|---|
| `src/core/shift.ts` | Metrics, flags, validation, CSV, the WhatsApp message |
| `src/agent.ts` | Claude agent with a `get_shift_metrics` tool |
| `src/harness/` | [TinyHarness](https://github.com/Tapovan11001/tinyharness), vendored |
| `web/` | Input, metrics and message side by side |

## Limits

- Manual entry or CSV. Pulling counts straight from PLCs or sensors is the obvious next step.
- Downtime reasons are free text; only common ones are translated in the Hindi message.

## License

MIT
