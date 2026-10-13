# Follow-up: build both ToF tables now, empty, and use the 7 testers as the smoke test

Your inventory is the most useful thing in this request — it told us door picks *are* instrumented,
which we did not know. Answers to your questions, and one question back that matters more than any
of them.

**Build both tables now.** Empty is fine as long as the plumbing works. Specifically:

- **`data_tof_runs`: emit all 10 rows** — every `segment × payer_flag` combination — with the keys
  filled, `players_in_cell = 0`, and **every metric column EMPTY**. Not zero. A blank says "nothing
  measurable yet"; a 0 would say "we measured it and nobody played", which is a different and false
  claim. The 10 rows existing is what proves the shape.
- **`data_tof_stages`: emit the rows you can** from whatever the testers did, and if that is nothing,
  emit the table with its header and no rows. An empty table with the right columns is useful; a
  missing table blocks us.
- **Then run both again with the filters OFF, as separate outputs** named
  `data_tof_runs_qa_unfiltered` and `data_tof_stages_qa_unfiltered`. Use the 7 testers. We do not
  want those numbers in the workbook — six Finnish QA accounts are not a cohort — but seeing the
  pipeline produce *something* end to end is worth more right now than seeing it produce nothing
  correctly. Keep them clearly named so they cannot be mistaken for the real tables.

**Filters stay ON for the real tables.** All six Finnish testers failing `geo NOT IN ('FI','PL')` is
the filter working, not a problem to route around.

---

## Approved: take the event start from `client_events_view_event_action`

Yes — approved, and thank you for asking rather than just doing it. ToF genuinely does not log to
`client_events_view_event_progress`, so there is nothing to be consistent with there.

**One caveat, because it is the part that would break comparability.** The three keys I asked you not
to re-derive were: event start, segment, and payer flag. Only the **event start** moves to
`event_action`. The other two must stay identical to the album recipe, which creates a problem you
will hit immediately: `player_profile_level` lives on `event_progress`, and ToF players have no rows
there *for this event*.

So for ToF, take the profile level from the player's **most recent `event_progress` reading before
the ToF start, regardless of which event it came from**. Same field, same quantity, just not scoped
to this event. That keeps `segment` meaning exactly what it means in the album tables — which is the
whole point, since the two will be read side by side.

If a player has no `event_progress` reading at all, drop them and report how many that was.

---

## The question I most want answered

Your `run_end` taxonomy is `cash_out`, `give_up`, `complete`. **Which of those is a run that died on
a pig?**

Our entire `bank_rate` depends on the answer, and none of the three obviously means "hit a pig and
did not pay to continue":

- `cash_out` → our "banked"
- `complete` → presumably reached the last stage, which we also count as banked
- `give_up` → ambiguous. Does it mean the player declined to pay for a continue (our pig death), or
  did they abandon a live run voluntarily?

If `give_up` covers both, we cannot separate them and `bank_rate` is the only number we get. If a
pig death emits no `run_end` at all, then runs have to be closed by inference (a `choose_door` with
`action_sub1 = pig` and no following `continue`), and that is worth knowing before anyone trusts a
rate.

**And a finding either way:** if `give_up` is a *voluntary* abandon, that is a behaviour our model
does not represent at all. Our runs end only by dying on a pig or by reaching the authored cash-out
stage — a player who walks away mid-run with rewards on the table does not exist in our simulation.
If it turns out to be common, tell us; it is a gap in our model, not in your data.

---

## Your gaps, each with a decision

**`doors_shown` — leave EMPTY.** You are right that only the chosen door is logged. Do not echo our
assumption back at us: our config authors **4 doors on every one of the 35 stages**, and if you
filled the column with 4 we would later read it as confirmation of a thing we had assumed. An empty
column plus your `pick_share` is the honest shape.

**The `empty` outcome — our config answers this.** You wrote *"Either the game has no empty doors or
they aren't logged; I can't tell which."* Our authored ladder has **no empty doors anywhere**: 140
doors across 35 stages, 113 `reward` and 27 `pig`, nothing else. So `reward` and `pig` are the
complete set and your two values are not a gap. Emit only those two, and if an `empty` ever appears
in the logs that is a config change worth flagging.

**`stage_n` — report which field works, and use a fallback if neither does.** Try `current_round`
first. If ToF does not fill it reliably, use the **pick ordinal within the run** (the *n*th
`choose_door` of that `current_run`) and name the column so we know which it is. The null
`current_round_type` on about a third of picks, mostly on the first day, reads like an early client
bug — worth a note, and worth re-checking once 2.11.0 is the only version in the data.

**`stage_type` mapping — confirmed, with one correction to my earlier prompt:**

| Your `current_round_type` | Our label |
|---|---|
| `firststage` | `Safe (Start)` |
| `regular` | `Standard` |
| `safe` | `Safe` |
| `milestone` | **`Milestone`** |

My first prompt said `Major Milestone`; the sheet actually says `Milestone`. Use `Milestone`.

**`coins_spent_continues_mean` — use `amount_item`, and here is why the cap warning does not bite.**
You spotted a real contradiction in my instructions. The resolution: the 0–9999 cap *silently zeroes
amounts above 9999*, and a single continue costs between **75 and 2,000 coins** — comfortably inside
the band. So `amount_item` on a `continue` action is safe. Two guards please:

- flag any `continue` row where `amount_item` is 0, blank, or ≥ 9999;
- and a validation that is better than a guard — our authored continue ladder is exactly
  **75, 150, 300, 500, 750, 1000, 1250, 1500, 1750, 2000**, in that order within a run. Measured
  continue costs should land **on those values**. If they do, both the field and the ladder are
  confirmed at once. If they do not, tell us the values you see; the ladder on our sheet may be out
  of date.

`player_daily.hc_gain` stays the rule for *gains* — it does not cover spend, and I should have said
so.

**`topups_bought_mean` — leave EMPTY, and this is a finding.** Our model assumes payers buy exactly
one mid-run coin top-up per run (`TOF_PAYER_TOPUPS = 1`). If no such action exists in the logs, that
assumption may be modelling a feature the game does not have. Please confirm there is no top-up or
mid-run purchase action; if there is none, we will retire the assumption.

**`tickets_unspent_mean` — measurable now.** `event_token_balance`, last reading of the window. Use
it.

**`tickets_earned_mean` — check `item_gain`.** Envelope grants live there under
`item_category = 'Envelope'`, so ToF tickets likely have their own category. If they do, that is the
column; if not, leave it empty.

**`cashout_stage_p50` — leave empty, but the good news is it is measurable.** `run_end` with
`action_sub1 = cash_out`, plus the stage at that moment, is exactly the number. It is our headline
precisely because our model currently reads a *fixed authored stage 10 for every segment*, which
nobody has ever checked. The first real season settles it.

---

## What we already know that may help you

- `event_reward_pool` (prizes accumulated so far in the run) is the closest thing to what our model
  calls the banked pot. If it is parseable, it would let us check reward composition per banked run,
  which nothing else can.
- `current_run` as a running count of runs started gives `runs_played` directly.
- Our ladder is **35 stages, 4 doors each, pigs only on `Standard` stages** — so our model expects
  **75% survival on a standard stage and 100% on safe/milestone/first**. A separate simulation
  written by your colleagues instead assumes pig odds that *rise with depth* (25% → 33% → 50%, with
  every 5th stage pig-free). Those two disagree, and your `pick_share` per stage is the measurement
  that settles which is right. It is the single most valuable thing in `data_tof_stages`.

## Cadence

Re-run both tables once ToF is actually live, and tell us the day it starts — our `day` index is
1-based from the official calendar start, same convention as the album tables.
