-- Album Daily: per-player percentiles + average for ALL album metrics/breakdowns, per day, optionally split by segments.
-- Long format: one row per event_date x metric x breakdown (x each enabled split dimension).
-- Zeros are included: every player in the filtered population counts, players without a metric row = 0.
-- Source: tmp_radekjanhuba.album_segmentation_daily (denominator + filters), album_metrics_daily (non-zero values).
-- Parameters (Beacon convention):
--   start_date, end_date          date
--   <dim>_multi                   multi-select filter, options from the data; '' (the ALL option) = no filter.
--                                 Beacon convention: the value is inserted inside quotes in the IN lists below; several values arrive as a','b
--   <dim>_split                   ', <dim>' = split by this dimension (adds a column of that name), '' = no split
--   dims: spend_group, level_completes_7d, spend_60d_percentile, spent_in_event, album_sod, sets_completed_sod, event_id
WITH seg AS (
    SELECT event_date, player_id,
           CAST(spend_group AS varchar) AS spend_group,
           CAST(level_completes_7d AS varchar) AS level_completes_7d,
           CAST(spend_60d_percentile AS varchar) AS spend_60d_percentile,
           CAST(spent_in_event AS varchar) AS spent_in_event,
           CAST(album_sod AS varchar) AS album_sod,
           CAST(sets_completed_sod AS varchar) AS sets_completed_sod,
           CAST(event_id AS varchar) AS event_id
    FROM tmp_radekjanhuba.album_segmentation_daily
    WHERE event_date BETWEEN DATE '2026-09-13' AND DATE '2026-10-13'
),

pop AS (
    SELECT event_date, event_id AS p_event, player_id,
           CONCAT_WS('|', 'x'      ) AS split_key
    FROM seg
    WHERE TRUE
      AND (greatest('') = '' OR spend_group IN (''))
      AND (greatest('') = '' OR level_completes_7d IN (''))
      AND (greatest('') = '' OR spend_60d_percentile IN (''))
      AND (greatest('') = '' OR spent_in_event IN (''))
      AND (greatest('') = '' OR album_sod IN (''))
      AND (greatest('') = '' OR sets_completed_sod IN (''))
      AND (greatest('') = '' OR event_id IN (''))
),

n AS (  -- denominator per day x split: everyone in the filtered population, zeros included
    SELECT event_date, split_key, COUNT(*) AS players_total
    FROM pop
    GROUP BY event_date, split_key
),

n_tot AS (
    SELECT event_date, split_key, players_total FROM n
),

m AS (
    -- album_metrics_daily has one row per album: collapse to one value per player-day x metric x breakdown
    -- (sum across albums; star_balance_max is a balance, so it takes the max)
    SELECT event_date AS m_date, event_id AS m_event, player_id AS m_player, metric, breakdown,
           CASE WHEN metric = 'star_balance_max' THEN MAX(value) ELSE SUM(value) END AS value
    FROM tmp_radekjanhuba.album_metrics_daily
    WHERE event_date BETWEEN DATE '2026-09-13' AND DATE '2026-10-13'
      AND breakdown IS NOT NULL
    GROUP BY event_date, event_id, player_id, metric, breakdown
),

h AS (  -- histogram of stored (non-zero) values
    SELECT p.event_date, p.split_key, m.metric, m.breakdown, m.value, COUNT(*) AS players
    FROM pop p
    JOIN m
      ON m.m_date   = p.event_date
     AND m.m_event  = p.p_event
     AND m.m_player = p.player_id
    GROUP BY p.event_date, p.split_key, m.metric, m.breakdown, m.value
),

h_tot AS (
    SELECT event_date, split_key, metric, breakdown, SUM(players) AS stored
    FROM h
    GROUP BY 1, 2, 3, 4
),

zeros AS (  -- implied zero bucket per day x split x metric x breakdown = everyone minus players with a stored row
    SELECT n.event_date, n.split_key, b.metric, b.breakdown, 0 AS value,
           n.players_total - COALESCE(t.stored, 0) AS players
    FROM n
    CROSS JOIN (SELECT DISTINCT metric, breakdown FROM h) b
    LEFT JOIN h_tot t
      ON t.event_date = n.event_date AND t.split_key = n.split_key
     AND t.metric = b.metric AND t.breakdown = b.breakdown
),

hist AS (
    SELECT event_date, split_key, metric, breakdown, value, players FROM h
    UNION ALL
    SELECT event_date, split_key, metric, breakdown, value, players FROM zeros WHERE players > 0
),

cum AS (
    SELECT event_date, split_key, metric, breakdown, value, players,
           SUM(players) OVER (PARTITION BY event_date, split_key, metric, breakdown ORDER BY value) AS cum_players
    FROM hist
)

SELECT
    c.event_date,
    c.metric,
    c.breakdown,
    t.players_total,
    MIN(CASE WHEN c.cum_players >= 0.25 * t.players_total THEN c.value END) AS p25,
    MIN(CASE WHEN c.cum_players >= 0.50 * t.players_total THEN c.value END) AS p50,
    MIN(CASE WHEN c.cum_players >= 0.75 * t.players_total THEN c.value END) AS p75,
    MIN(CASE WHEN c.cum_players >= 0.90 * t.players_total THEN c.value END) AS p90,
    MIN(CASE WHEN c.cum_players >= 0.95 * t.players_total THEN c.value END) AS p95,
    SUM(c.value * c.players) * 1.0 / t.players_total                         AS avg_value,
    SUM(CASE WHEN c.value > 0 THEN c.players END)                            AS players_nonzero
FROM cum c
JOIN n_tot t ON t.event_date = c.event_date AND t.split_key = c.split_key
GROUP BY c.event_date, c.split_key, c.metric, c.breakdown, t.players_total
ORDER BY c.event_date, c.metric, c.breakdown
