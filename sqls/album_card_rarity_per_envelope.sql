-- Album Envelope Overview: what envelopes give, per envelope rarity, over the selected date range.
-- Output (long): event_id (season) | [split columns] | album | envelope | measure | item | value | base | ratio
--   measure 'card_rarity'        : item = card rarity (1..6), value = cards of that rarity from the envelope, base = all cards from that envelope, ratio = share of the envelope's cards
--   measure 'pity_probability'   : item = pity probability at opening ('0.00', '0.33', ... , 'unknown'), value = openings, base = all openings of that envelope, ratio = share of openings
--                                  ('0.00' is derived: openings minus the stored pity rows; 'unknown' = the value was not recorded)
--   measure 'stars_per_envelope' : item = 'all', value = stars gained from the envelope, base = envelopes opened, ratio = average stars per opened envelope
-- Population: players seen so far in album_segmentation_daily up to end_date, segment fixed to the FIRST day seen (stable cohorts), same as the Overview query.
-- Filters respected: spend_group, level_completes_7d, spend_60d_percentile, spent_in_event, event_id. Splits: the same four (event_id and album are always columns).
-- IGNORED by design (declared below only so the dashboard can send them): album_sod, sets_completed_sod and event_id_split. Use the album column to look at one album.
--     
-- Sources: tmp_radekjanhuba.album_segmentation_daily, tmp_radekjanhuba.album_metrics_daily (snaps_gained crossed breakdown, envelopes_opened, pity_probability, stars_gained by envelope).
WITH seg AS (
    SELECT event_date, event_id, player_id,
           CAST(spend_group AS varchar) AS spend_group,
           CAST(level_completes_7d AS varchar) AS level_completes_7d,
           CAST(spend_60d_percentile AS varchar) AS spend_60d_percentile,
           CAST(spent_in_event AS varchar) AS spent_in_event
    FROM tmp_radekjanhuba.album_segmentation_daily
    WHERE event_date <= DATE '2026-10-13'
),

first_seen AS (
    SELECT * FROM (
        SELECT seg.*, ROW_NUMBER() OVER (PARTITION BY event_id, player_id ORDER BY event_date) AS rn
        FROM seg
    )
    WHERE rn = 1
),

cohort AS (
    SELECT event_id, player_id, event_date AS first_date,
           CONCAT_WS('|', 'x'    ) AS split_key
    FROM first_seen
    WHERE TRUE
      AND (greatest('') = '' OR spend_group IN (''))
      AND (greatest('') = '' OR level_completes_7d IN (''))
      AND (greatest('') = '' OR spend_60d_percentile IN (''))
      AND (greatest('') = '' OR spent_in_event IN (''))
      AND (greatest('') = '' OR event_id IN (''))
),

m AS (   -- the envelope-related metric rows in the selected range, collapsed per player x album
    SELECT event_id, player_id, album, metric, breakdown, SUM(value) AS value
    FROM tmp_radekjanhuba.album_metrics_daily
    WHERE event_date BETWEEN DATE '2026-09-13' AND DATE '2026-10-13'
      AND (   (metric = 'snaps_gained'     AND breakdown LIKE 'envelope:%|snap_rarity:%')
           OR (metric = 'envelopes_opened' AND breakdown LIKE 'rarity:%')
           OR  metric = 'pity_probability'
           OR (metric = 'stars_gained'     AND breakdown LIKE 'envelope:%'))
    GROUP BY 1, 2, 3, 4, 5
),

mp AS (   -- parse envelope rarity and item out of the breakdown label
    SELECT event_id, player_id, album, metric, value,
           CASE metric WHEN 'envelopes_opened' THEN SUBSTR(breakdown, 8)
                       ELSE SPLIT_PART(SPLIT_PART(breakdown, '|', 1), ':', 2) END AS envelope,
           CASE WHEN metric IN ('snaps_gained', 'pity_probability') THEN SPLIT_PART(SPLIT_PART(breakdown, '|', 2), ':', 2)
                ELSE 'all' END AS item
    FROM m
),

mc AS (   -- restricted to the filtered cohort, aggregated per group
    SELECT c.event_id, c.split_key, mp.album, mp.envelope, mp.metric, mp.item, SUM(mp.value) AS value
    FROM mp
    INNER JOIN cohort AS c ON c.event_id = mp.event_id AND c.player_id = mp.player_id
    GROUP BY c.event_id, c.split_key, mp.album, mp.envelope, mp.metric, mp.item
),

opens AS (
    SELECT event_id, split_key, album, envelope, value AS opens
    FROM mc WHERE metric = 'envelopes_opened'
),

pity_sum AS (
    SELECT event_id, split_key, album, envelope, SUM(value) AS stored
    FROM mc WHERE metric = 'pity_probability'
    GROUP BY 1, 2, 3, 4
),

card_rows AS (
    SELECT event_id, split_key, album, envelope, 'card_rarity' AS measure, item, value,
           SUM(value) OVER (PARTITION BY event_id, split_key, album, envelope) AS base
    FROM mc WHERE metric = 'snaps_gained'
),

pity_rows AS (
    SELECT m.event_id, m.split_key, m.album, m.envelope, 'pity_probability' AS measure, m.item, m.value, o.opens AS base
    FROM mc AS m
    INNER JOIN opens AS o ON o.event_id = m.event_id AND o.split_key = m.split_key AND o.album = m.album AND o.envelope = m.envelope
    WHERE m.metric = 'pity_probability'
    UNION ALL
    SELECT m.event_id, m.split_key, m.album, m.envelope, 'pity_probability', '0.00', o.opens - COALESCE(p.stored, 0), o.opens
    FROM mc AS m
    INNER JOIN opens AS o ON o.event_id = m.event_id AND o.split_key = m.split_key AND o.album = m.album AND o.envelope = m.envelope
    LEFT JOIN pity_sum AS p ON p.event_id = m.event_id AND p.split_key = m.split_key AND p.album = m.album AND p.envelope = m.envelope
    WHERE m.metric = 'envelopes_opened' AND o.opens - COALESCE(p.stored, 0) > 0
),

star_rows AS (
    SELECT m.event_id, m.split_key, m.album, m.envelope, 'stars_per_envelope' AS measure, 'all' AS item, m.value, o.opens AS base
    FROM mc AS m
    INNER JOIN opens AS o ON o.event_id = m.event_id AND o.split_key = m.split_key AND o.album = m.album AND o.envelope = m.envelope
    WHERE m.metric = 'stars_gained'
),

combined AS (
    SELECT * FROM card_rows
    UNION ALL
    SELECT * FROM pity_rows
    UNION ALL
    SELECT * FROM star_rows
)

SELECT event_id, album, envelope, measure, item,
       CAST(value AS bigint) AS value,
       CAST(base AS bigint) AS base,
       value * 1.0 / base AS ratio
FROM combined
WHERE base > 0
ORDER BY event_id, album, envelope, measure, item
