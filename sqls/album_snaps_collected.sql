-- Album Overview: distribution (p25..p95 + average) of each qualified player's CUMULATIVE totals per season, per day, optionally split by segments.
-- Output (long): event_date | event_id (season) | [split columns] | measure | album | players_qualified | p25 p50 p75 p90 p95 | avg_value | is_end_date
--   measure (value = each player's total since the season start, up to event_date):
--     albums_completed, sets_completed (album NULL = all albums, album 1/2/.. = that album), cards_total, cards_unique, cards_duplicate (all albums), stars_gained,
--     cards_found_pct (album = 1/2/..; % of the album's unique cards found: unique cards / cards in the album, so 100 = complete album)
--   is_end_date = 1 on the selected end date: filter on it for the 'total' (snapshot) widgets instead of the daily time series.
-- Qualified players: those who have opened 2+ envelopes by the day (the intro envelope does not count); a player counts from the day they qualify.
-- Denominator / cohort: players seen so far in album_segmentation_daily (from the event start up to the day), segment fixed to the FIRST day seen (stable cohorts).
-- Zeros are included: a qualified player with nothing yet has value 0.
-- Filters respected: spend_group, level_completes_7d, spend_60d_percentile, spent_in_event, event_id. Splits: the same four (event_id is always a column).
-- IGNORED by design (declared below only so the dashboard can send them): album_sod, sets_completed_sod and event_id_split.
--     
-- Sources: tmp_radekjanhuba.album_segmentation_daily, tmp_radekjanhuba.album_metrics_daily (envelopes_opened, sets_completed, albums_completed, snaps_gained, stars_gained), hex_abgbproduction_174525b3.album_snaps (cards per album).
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

start_day AS (
    SELECT MIN(event_date) AS d0 FROM seg
),

days AS (
    SELECT CAST(d AS date) AS event_date   -- SEQUENCE returns timestamps in Athena; Redash needs a real date column
    FROM start_day
    CROSS JOIN UNNEST(SEQUENCE(d0, DATE '2026-10-13', INTERVAL '1' DAY)) AS t (d)
),

m AS (   -- metrics collapsed to one delta per player x day x album x metric x breakdown
    SELECT event_id, player_id, album, event_date, metric, breakdown, SUM(value) AS delta
    FROM tmp_radekjanhuba.album_metrics_daily
    WHERE event_date <= DATE '2026-10-13'
      AND (   (metric = 'envelopes_opened' AND breakdown = 'total')
           OR (metric = 'sets_completed'   AND breakdown = 'total')
           OR (metric = 'albums_completed' AND breakdown = 'total')
           OR (metric = 'snaps_gained'     AND breakdown IN ('total', 'unique', 'duplicate'))
           OR (metric = 'stars_gained'     AND breakdown = 'total'))
    GROUP BY 1, 2, 3, 4, 5, 6
),

env_cum AS (
    SELECT event_id, player_id, event_date,
           SUM(SUM(delta)) OVER (PARTITION BY event_id, player_id ORDER BY event_date) AS envelopes_so_far
    FROM m
    WHERE metric = 'envelopes_opened'
    GROUP BY 1, 2, 3
),

qualified AS (   -- first day a player has opened 2+ envelopes
    SELECT event_id, player_id, MIN(event_date) AS q_date
    FROM env_cum
    WHERE envelopes_so_far >= 2
    GROUP BY 1, 2
),

qp AS (   -- qualified cohort members; counted from the later of first seen and qualified
    SELECT c.event_id, c.player_id, c.split_key, GREATEST(c.first_date, q.q_date) AS eff_date
    FROM cohort AS c
    INNER JOIN qualified AS q ON q.event_id = c.event_id AND q.player_id = c.player_id
),

streams AS (   -- daily deltas per stream; album = -1 means 'all albums'
    SELECT event_id, player_id, event_date, 'albums_completed' AS measure, -1 AS album, SUM(delta) AS delta
    FROM m WHERE metric = 'albums_completed' AND breakdown = 'total' GROUP BY event_id, player_id, event_date
    UNION ALL
    SELECT event_id, player_id, event_date, 'sets_completed' AS measure, -1 AS album, SUM(delta) AS delta
    FROM m WHERE metric = 'sets_completed' AND breakdown = 'total' GROUP BY event_id, player_id, event_date
    UNION ALL
    SELECT event_id, player_id, event_date, 'sets_completed' AS measure, album AS album, SUM(delta) AS delta
    FROM m WHERE metric = 'sets_completed' AND breakdown = 'total' GROUP BY event_id, player_id, event_date, album
    UNION ALL
    SELECT event_id, player_id, event_date, 'cards_total' AS measure, -1 AS album, SUM(delta) AS delta
    FROM m WHERE metric = 'snaps_gained' AND breakdown = 'total' GROUP BY event_id, player_id, event_date
    UNION ALL
    SELECT event_id, player_id, event_date, 'cards_unique' AS measure, -1 AS album, SUM(delta) AS delta
    FROM m WHERE metric = 'snaps_gained' AND breakdown = 'unique' GROUP BY event_id, player_id, event_date
    UNION ALL
    SELECT event_id, player_id, event_date, 'cards_duplicate' AS measure, -1 AS album, SUM(delta) AS delta
    FROM m WHERE metric = 'snaps_gained' AND breakdown = 'duplicate' GROUP BY event_id, player_id, event_date
    UNION ALL
    SELECT event_id, player_id, event_date, 'cards_found_pct' AS measure, album AS album, SUM(delta) AS delta
    FROM m WHERE metric = 'snaps_gained' AND breakdown = 'unique' GROUP BY event_id, player_id, event_date, album
    UNION ALL
    SELECT event_id, player_id, event_date, 'stars_gained' AS measure, -1 AS album, SUM(delta) AS delta
    FROM m WHERE metric = 'stars_gained' AND breakdown = 'total' GROUP BY event_id, player_id, event_date
),

keys AS (
    SELECT DISTINCT measure, album FROM streams
),

spine AS (   -- every qualified player x every day x every stream, so players without activity keep their running total
    SELECT p.event_id, p.player_id, p.split_key, p.eff_date, k.measure, k.album, d.event_date
    FROM qp AS p
    CROSS JOIN keys AS k
    CROSS JOIN days AS d
),

vals AS (
    SELECT * FROM (
        SELECT s.event_id, s.split_key, s.event_date, s.measure, s.album, s.eff_date,
               SUM(COALESCE(t.delta, 0)) OVER (PARTITION BY s.event_id, s.player_id, s.measure, s.album ORDER BY s.event_date) AS value
        FROM spine AS s
        LEFT JOIN streams AS t
          ON t.event_id = s.event_id AND t.player_id = s.player_id
         AND t.measure = s.measure AND t.album = s.album AND t.event_date = s.event_date
    )
    WHERE event_date >= eff_date
),

hist AS (
    SELECT event_date, event_id, split_key, measure, album, value, COUNT(*) AS players
    FROM vals
    GROUP BY event_date, event_id, split_key, measure, album, value
),

cum AS (
    SELECT event_date, event_id, split_key, measure, album, value, players,
           SUM(players) OVER (PARTITION BY event_date, event_id, split_key, measure, album ORDER BY value) AS cum_players,
           SUM(players) OVER (PARTITION BY event_date, event_id, split_key, measure, album) AS n
    FROM hist
),

album_size AS (
    SELECT event_id, COUNT(DISTINCT snap_id) AS cards
    FROM hex_abgbproduction_174525b3.album_snaps
    GROUP BY 1
),

scaled AS (   -- percentiles of unique cards are converted to % of the album (cards_found_pct); every other measure keeps its own unit
    SELECT c.*, CASE WHEN c.measure = 'cards_found_pct' THEN 100.0 / z.cards ELSE 1.0 END AS scale
    FROM cum AS c
    LEFT JOIN album_size AS z ON z.event_id = c.event_id
)

SELECT
    event_date,
    event_id,
    measure,
    NULLIF(album, -1) AS album,
    n AS players_qualified,
    CAST(MIN(CASE WHEN cum_players >= 0.25 * n THEN value END) * scale AS double) AS p25,
    CAST(MIN(CASE WHEN cum_players >= 0.50 * n THEN value END) * scale AS double) AS p50,
    CAST(MIN(CASE WHEN cum_players >= 0.75 * n THEN value END) * scale AS double) AS p75,
    CAST(MIN(CASE WHEN cum_players >= 0.90 * n THEN value END) * scale AS double) AS p90,
    CAST(MIN(CASE WHEN cum_players >= 0.95 * n THEN value END) * scale AS double) AS p95,
    CAST(SUM(value * players) * 1.0 / n * scale AS double) AS avg_value,
    CASE WHEN event_date = DATE '2026-10-13' THEN 1 ELSE 0 END AS is_end_date
FROM scaled
WHERE event_date BETWEEN DATE '2026-09-13' AND DATE '2026-10-13'
GROUP BY event_date, event_id, split_key, measure, album, n, scale
ORDER BY event_date, event_id, measure, album
