-- Album Daily: DAU split into buckets of how many times the album view was opened that day (0 / 1 / 2-5 / 6+), per day, optionally split by segments.
-- Zeros are included: every player in the filtered population counts, players without an album_opens row = bucket 'A 0'.
-- Source: tmp_radekjanhuba.album_segmentation_daily (population + filters), tmp_radekjanhuba.album_metrics_daily (metric 'album_opens', breakdown 'total').
-- Same parameters as the percentile query (start_date, end_date, <dim>_multi, <dim>_split). Output: one row per day x split x bucket.
-- TODO: the tutorial album open is not excluded yet (it cannot be identified in the data so far).
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
    -- summed per player-day: the metrics table can hold more than one row for the same key (seen on 2026-10-02)
    SELECT event_date AS m_date, event_id AS m_event, player_id AS m_player, SUM(value) AS value
    FROM tmp_radekjanhuba.album_metrics_daily
    WHERE event_date BETWEEN DATE '2026-09-13' AND DATE '2026-10-13'
      AND metric = 'album_opens'
      AND breakdown = 'total'
    GROUP BY 1, 2, 3
    HAVING SUM(value) > 0
),

player_bucket AS (
    SELECT p.event_date, p.split_key,
           CASE WHEN m.value = 1 THEN 'B 1'
                WHEN m.value <= 5 THEN 'C 2-5'
                ELSE 'D 6+' END AS opens_bucket
    FROM pop p
    JOIN m
      ON m.m_date   = p.event_date
     AND m.m_event  = p.p_event
     AND m.m_player = p.player_id
),

opens AS (  -- players per non-zero bucket (no split columns here; joined back on split_key)
    SELECT event_date, split_key, opens_bucket, COUNT(*) AS players
    FROM player_bucket
    GROUP BY 1, 2, 3
),

opens_tot AS (
    SELECT event_date, split_key, SUM(players) AS players_opened
    FROM opens
    GROUP BY 1, 2
),

buckets AS (
    SELECT * FROM (VALUES ('A 0'), ('B 1'), ('C 2-5'), ('D 6+')) AS t (opens_bucket)
)

SELECT
    n.event_date,
    b.opens_bucket,
    CASE WHEN b.opens_bucket = 'A 0' THEN n.players_total - COALESCE(ot.players_opened, 0)
         ELSE COALESCE(o.players, 0) END AS players,
    n.players_total,
    (CASE WHEN b.opens_bucket = 'A 0' THEN n.players_total - COALESCE(ot.players_opened, 0)
          ELSE COALESCE(o.players, 0) END) * 1.0 / n.players_total AS share_of_players
FROM n
CROSS JOIN buckets b
LEFT JOIN opens o
  ON o.event_date = n.event_date AND o.split_key = n.split_key AND o.opens_bucket = b.opens_bucket
LEFT JOIN opens_tot ot
  ON ot.event_date = n.event_date AND ot.split_key = n.split_key
ORDER BY n.event_date, b.opens_bucket
