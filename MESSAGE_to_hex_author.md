Hi — found something in the "ABDB - Album performance vs predictions" notebook that I think makes
the comparison charts misleading. Nothing wrong with your queries; it's the way the two sides are
matched up.

**The short version:** your player groups and my player groups both use the labels `0-9`, `10-19`,
`20-39`, `40-99`, `100+` — but they mean two completely different things. They join together
perfectly, so nothing errors, and the charts end up comparing different groups of players.

**Yours** come from the player's profile level — how far through the game they are. So `100+` means
"past level 100", which is most of the player base.

**Mine** come from how many saga levels a player finishes per day, averaged over the previous week.
So my `100+` means "finishes 100+ levels a day, every day" — a tiny group of extremely heavy
players.

You can see it in the group sizes. Same labels, opposite shapes:

| Group | Mine | Yours |
|---|---|---|
| `0-9 NONPAYER` | 107,126 | 221 |
| `40-99 PAYER` | 10,805 | 14,362 |
| `100+ PAYER` | 1,362 | 44,259 |

In my data `0-9` is the biggest group and `100+` is the smallest. In yours it's the other way round.
If it were just a different date range or a different filter, every group would be off by roughly
the same amount — instead it slides from almost nothing at the bottom to 32× at the top, which is
what you get when the two measures are different things.

**Where it happens:** the last line of the join in `04_album_bands_vs_actual.sql`:

```sql
ON CAST(b.level_bucket AS VARCHAR) = a.level_bucket
```

`b` is the percentile band file (my simulation output), `a` is your actuals. The column on your side
is honestly named `level_bucket` — it really is a level bucket. The problem is only that my side
isn't, even though it's labelled the same way.

**Practical effect:** on the "Album %" and "Packs Opened" charts, the `100+` panel is putting my
prediction for ~1,400 very heavy players next to the real behaviour of ~44,000 ordinary
high-level players. The prediction looks far too high, and it isn't the prediction that's wrong.

**What would fix it:** bucket players on the rolling 7-day average of saga levels completed per day,
rather than on profile level. The exact definition is in `sqls/data_seg_beh.sql` — happy to walk
through it, and I've written up the steps if that's easier. Two details that are easy to miss:

- the average only counts days the player actually completed something, not all seven days; and
- players who completed no saga levels in the window aren't in my population at all, which is part
  of why my totals are bigger (350k vs 165k).

One more small thing while you're in there: the payer flag. Yours is the last reading before day 1,
mine is "paid anything at any point during the window", so a player who first pays on day 3 lands in
a different group in each.

No rush on any of this, and the notebook itself is genuinely useful — I've reused your
`album_actuals_player` query as the basis for the data feed. Just wanted to flag it before anyone
draws a conclusion from the `100+` panel.
