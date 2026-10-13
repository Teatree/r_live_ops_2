-- Album Daily: CUMULATIVE set completion and album completion, per day, optionally split by segments.
-- Output (long): event_date [split columns] measure | album | item | players_completed | players_total | share | is_end_date (1 on the selected end date: filter on it for snapshot widgets)
--   measure 'set_completion'   : item = k, album = album number; share = % of players who have completed AT LEAST k sets of that album by the day (k = 1 is 'any set')
--   measure 'set_completion_by_set' : item = set id, album = album number; share = % of players who have completed that specific set by the day (needs the set_completed metric)
--   measure 'album_completion' : item = n, album = NULL; share = % of players who have completed at least n albums by the day
-- Cohort (denominator): players seen so far = distinct players in album_segmentation_daily on any day from the event start up to the day.
-- A player's segment (filters + splits) is fixed to their FIRST day seen (stable cohorts). Cumulation always starts at the event start; start_date/end_date only choose the days shown.
-- Filters respected: spend_group, level_completes_7d, spend_60d_percentile, spent_in_event, event_id.
-- album_sod and sets_completed_sod are IGNORED by design (they are declared below only so the dashboard can send them):
--    
-- Source of completions: tmp_radekjanhuba.album_metrics_daily, metrics sets_completed / albums_completed (breakdown 'total'); no set ids needed, so no raw events are read.
-- Per-set lines (completion of set 3 specifically) are not possible from these metrics; see album_daily_completion_raw_events.sql for that.
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
    SELECT event_id AS p_event, player_id, event_date AS first_date,
           CONCAT_WS('|', 'x'     ) AS split_key
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

groups AS (
    SELECT DISTINCT split_key FROM cohort
),

joins AS (
    SELECT first_date AS event_date, split_key, COUNT(*) AS new_players
    FROM cohort
    GROUP BY 1, 2
),

den AS (   -- cohort size per day x split group (players seen so far)
    SELECT d.event_date, g.split_key,
           SUM(COALESCE(j.new_players, 0)) OVER (PARTITION BY g.split_key ORDER BY d.event_date) AS players_total
    FROM days AS d
    CROSS JOIN groups AS g
    LEFT JOIN joins AS j ON j.event_date = d.event_date AND j.split_key = g.split_key
),

set_totals AS (   -- sets completed per player x day x album (the metric value is the number of sets completed that day)
    SELECT event_id, player_id, album, event_date, SUM(value) AS sets_done
    FROM tmp_radekjanhuba.album_metrics_daily
    WHERE metric = 'sets_completed'
      AND breakdown = 'total'
      AND event_date <= DATE '2026-10-13'
    GROUP BY 1, 2, 3, 4
),

set_cum AS (
    SELECT event_id, player_id, album, event_date,
           SUM(sets_done) OVER (PARTITION BY event_id, player_id, album ORDER BY event_date) AS sets_so_far
    FROM set_totals
),

max_sets AS (
    SELECT GREATEST(COALESCE(MAX(sets_so_far), 0), 1) AS mx FROM set_cum
),

set_reach AS (   -- first day a player has completed at least k sets of an album
    SELECT c.event_id, c.player_id, c.album, k.k AS item, MIN(c.event_date) AS completed_date
    FROM set_cum AS c
    CROSS JOIN max_sets AS m
    CROSS JOIN UNNEST(SEQUENCE(1, m.mx)) AS k (k)
    WHERE c.sets_so_far >= k.k
    GROUP BY 1, 2, 3, 4
),

set_hits AS (   -- effective date = later of first seen and completion, so a numerator never exceeds its denominator
    SELECT c.split_key, r.album, r.item, GREATEST(c.first_date, r.completed_date) AS event_date, COUNT(*) AS players
    FROM set_reach AS r
    INNER JOIN cohort AS c ON c.p_event = r.event_id AND c.player_id = r.player_id
    GROUP BY 1, 2, 3, 4
),

set_items AS (
    SELECT DISTINCT album, item FROM set_hits
),

sets_out AS (
    SELECT s.event_date, s.split_key, s.album, s.item, s.players_total,
           SUM(COALESCE(h.players, 0)) OVER (PARTITION BY s.split_key, s.album, s.item ORDER BY s.event_date) AS players_completed
    FROM (
        SELECT dn.event_date, dn.split_key, dn.players_total, it.album, it.item
        FROM den AS dn
        CROSS JOIN set_items AS it
    ) AS s
    LEFT JOIN set_hits AS h
      ON h.event_date = s.event_date AND h.split_key = s.split_key AND h.album = s.album AND h.item = s.item
),

set_id_first AS (   -- first day a player completed a specific set (metric set_completed, breakdown 'set:<id>')
    SELECT event_id, player_id, album, CAST(SUBSTR(breakdown, 5) AS integer) AS item, MIN(event_date) AS completed_date
    FROM tmp_radekjanhuba.album_metrics_daily
    WHERE metric = 'set_completed'
      AND breakdown LIKE 'set:%'
      AND event_date <= DATE '2026-10-13'
    GROUP BY 1, 2, 3, 4
),

set_id_hits AS (
    SELECT c.split_key, f.album, f.item, GREATEST(c.first_date, f.completed_date) AS event_date, COUNT(*) AS players
    FROM set_id_first AS f
    INNER JOIN cohort AS c ON c.p_event = f.event_id AND c.player_id = f.player_id
    GROUP BY 1, 2, 3, 4
),

set_id_items AS (
    SELECT DISTINCT album, item FROM set_id_hits
),

set_id_out AS (
    SELECT s.event_date, s.split_key, s.album, s.item, s.players_total,
           SUM(COALESCE(h.players, 0)) OVER (PARTITION BY s.split_key, s.album, s.item ORDER BY s.event_date) AS players_completed
    FROM (
        SELECT dn.event_date, dn.split_key, dn.players_total, it.album, it.item
        FROM den AS dn
        CROSS JOIN set_id_items AS it
    ) AS s
    LEFT JOIN set_id_hits AS h
      ON h.event_date = s.event_date AND h.split_key = s.split_key AND h.album = s.album AND h.item = s.item
),

album_totals AS (
    SELECT event_id, player_id, event_date, SUM(value) AS albums_done
    FROM tmp_radekjanhuba.album_metrics_daily
    WHERE metric = 'albums_completed'
      AND breakdown = 'total'
      AND event_date <= DATE '2026-10-13'
    GROUP BY 1, 2, 3
),

album_cum AS (
    SELECT event_id, player_id, event_date,
           SUM(albums_done) OVER (PARTITION BY event_id, player_id ORDER BY event_date) AS albums_so_far
    FROM album_totals
),

max_albums AS (
    SELECT GREATEST(COALESCE(MAX(albums_so_far), 0), 1) AS mx FROM album_cum
),

album_reach AS (   -- first day a player has completed at least n albums
    SELECT c.event_id, c.player_id, n.n AS item, MIN(c.event_date) AS completed_date
    FROM album_cum AS c
    CROSS JOIN max_albums AS m
    CROSS JOIN UNNEST(SEQUENCE(1, m.mx)) AS n (n)
    WHERE c.albums_so_far >= n.n
    GROUP BY 1, 2, 3
),

album_hits AS (
    SELECT c.split_key, r.item, GREATEST(c.first_date, r.completed_date) AS event_date, COUNT(*) AS players
    FROM album_reach AS r
    INNER JOIN cohort AS c ON c.p_event = r.event_id AND c.player_id = r.player_id
    GROUP BY 1, 2, 3
),

album_items AS (
    SELECT DISTINCT item FROM album_hits
),

albums_out AS (
    SELECT s.event_date, s.split_key, CAST(NULL AS integer) AS album, s.item, s.players_total,
           SUM(COALESCE(h.players, 0)) OVER (PARTITION BY s.split_key, s.item ORDER BY s.event_date) AS players_completed
    FROM (
        SELECT dn.event_date, dn.split_key, dn.players_total, it.item
        FROM den AS dn
        CROSS JOIN album_items AS it
    ) AS s
    LEFT JOIN album_hits AS h
      ON h.event_date = s.event_date AND h.split_key = s.split_key AND h.item = s.item
),

combined AS (
    SELECT 'set_completion' AS measure, event_date, album, item, players_completed, players_total FROM sets_out
    UNION ALL
    SELECT 'album_completion', event_date, album, item, players_completed, players_total FROM albums_out
    UNION ALL
    SELECT 'set_completion_by_set', event_date, album, item, players_completed, players_total FROM set_id_out
)

SELECT event_date, measure, album, item,
       CAST(players_completed AS bigint) AS players_completed,
       players_total,
       players_completed * 1.0 / players_total AS share,
       CASE WHEN event_date = DATE '2026-10-13' THEN 1 ELSE 0 END AS is_end_date
FROM combined
WHERE event_date BETWEEN DATE '2026-09-13' AND DATE '2026-10-13'
  AND players_total > 0
ORDER BY event_date, measure, album, item
