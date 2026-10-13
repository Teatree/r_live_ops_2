Hi — I need read access from Hex to two tables, and I think the diagnosis is already clear enough
to make it a quick fix.

**What I need:**

```
tmp_radekjanhuba.album_metrics_daily
tmp_radekjanhuba.album_segmentation_daily
```

granted to the **Hex "Athena cloud" connection** (whatever role that connection assumes).

**Why I think it's a grant/schema issue rather than a missing table.** All seven of the production
album queries read those two tables right now, so they exist and are in daily use. From Hex they are
invisible — a search of the `tmp_radekjanhuba` schema and of the whole connection returns nothing.
But the third table those same queries use, `hex_abgbproduction_174525b3.album_snaps`, **is**
visible from Hex.

So: the Hex connection can read `hex_*` schemas and cannot read `tmp_radekjanhuba`. That reads like
a permissions scope rather than anything being moved or dropped.

Two of the production queries also mention the "Beacon convention" in their parameters, so I assume
the dashboards run through Beacon, and Beacon's connection has grants that Hex's does not. If that's
right, matching Hex's grants to Beacon's would do it.

**What I'm trying to do.** Compare our album economy simulation against live player behaviour. The
blocker is one column: `album_segmentation_daily.level_completes_7d`. Our simulation segments players
by how many saga levels they complete per day over a rolling week, and without that column the
notebook has to bucket on profile level instead — which produces groups that differ from ours by up
to 32×, so the comparison is meaningless. `album_metrics_daily` is the other half: it carries
envelope rarity, card rarity and pity probability as breakdowns that are painful to rebuild from raw
events, and a hand-rebuild wouldn't match the dashboards anyway.

**Any one of these unblocks me:**

1. Grant the Hex connection read on `tmp_radekjanhuba` (simplest if the grants are the only issue).
2. Copy or materialise those two tables into a shared schema — `hex_abgbproduction_174525b3` would
   be ideal, since Hex already reads it.
3. Tell me the correct fully-qualified name if they have moved, and I'll point at that instead.

**One thing worth raising separately:** seven production dashboards currently depend on tables in a
personal `tmp_<name>` schema. That works until it doesn't — a cleanup, an offboarding, or a quota
sweep would take all seven down at once. Promoting them to a shared schema would fix my problem and
that one together, if there's appetite for it.

Thanks — happy to be pointed at whoever owns the Athena grants if that's not you.
