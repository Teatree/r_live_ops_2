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

**What would fix it, and it's smaller than it sounds:** there's already a column for the measure I
use. `tmp_radekjanhuba.album_segmentation_daily` has **`level_completes_7d`**, and every one of the
seven production album queries filters and splits on it. So instead of bucketing on profile level,
join to that table and use that column — no new logic, and it puts the charts on the same axis as
the album dashboards.

Worth checking the bucket values first (`SELECT level_completes_7d, COUNT(DISTINCT player_id) ...
GROUP BY 1`) — the column name matches my axis but I haven't confirmed the boundaries are the same
five bands. If they're raw numbers rather than `0-9`/`10-19`/..., let me know and we'll agree the
mapping rather than guessing.

Same table also has `spend_group`, which is probably a cleaner source for the payer split than the
`player_daily` lookup — yours takes the last reading before day 1, mine is "paid anything at any
point during the window", so a player who first pays on day 3 lands in a different group in each.

One other thing: my population is bigger (350k vs 165k) partly because players who completed no
saga levels in the window aren't in mine at all.

No rush on any of this, and the notebook itself is genuinely useful — I've reused your
`album_actuals_player` query as the basis for the data feed. Just wanted to flag it before anyone
draws a conclusion from the `100+` panel.
