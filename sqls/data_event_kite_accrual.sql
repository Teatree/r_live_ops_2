-- =============================================================================
-- Export refresh triggers: {{ refresh_all_request_id_input }} {{ refresh_data_event_kite_accrual_request_id_input }}
-- KITE FESTIVAL ACCRUAL CURVE (score path) — the 7->3 duration multiplier
-- Grain: event x segment x payer x event-day  ·  Window: Apr 29–May 31 2026 (33d)
--
-- OUTPUT  (sheet `data_event_kite_accrual`)
-- Each row = one (Kite instance-day, segment, payer): cumulative share of a participant's eventual Kite SCORE accrued by the end of that event-day. Same columns as data_event_accrual (score sits in the token-share fields); read event_day = 3 for the 7->3 cut.
--
--   event_name                   'Kite Festival'
--   payer_flag                   NONPAYER / PAYER
--   segment                      segment tier
--   seg_rank                     segment sort key
--   event_day                    day index within the instance (1 = first day)
--   instance_length_days         N days of the instance
--   n_instances                  Kite instances pooled
--   n_participants               distinct participants (positive total score)
--   cum_token_share_mean         mean cumulative SCORE share by this day  <- the multiplier
--   cum_token_share_p50/p25/p75  distribution of that score share
--   cum_levels_share_mean        NULL for Kite (score path, no level tokens)
--
-- LOUD FLAGS
--  Kite is score-submission (event_action / m_score_reached), not token-based;
--  streak-build is NON-LINEAR, so use this measured curve, never a linear scale.
--  Multi-day instances only, fully within the window. [C1]-[C6] of
--  data_event_accrual apply.
-- =============================================================================
WITH params AS (
    SELECT
        DATE '2026-04-29' AS start_date,        -- << editable: period start (inclusive)
        DATE '2026-05-31' AS end_date,          -- << editable: period end   (inclusive)
        50   AS min_resource_earners,           -- << (unused; verbatim from anchor)
        0.0  AS min_pct_of_pool                 -- << (unused; verbatim from anchor)
),
date_bounds AS (
    SELECT start_date, end_date,
        CAST(date_format(start_date - INTERVAL '6' DAY, '%Y%m%d') AS INTEGER) AS rolling_start_pd,
        CAST(date_format(start_date,                    '%Y%m%d') AS INTEGER) AS start_date_pd,
        CAST(date_format(end_date,                      '%Y%m%d') AS INTEGER) AS end_date_pd
    FROM params
),
daily_completions AS (
    SELECT ls.player_id,
        CAST(date_parse(CAST(ls.processdate AS VARCHAR), '%Y%m%d') AS DATE) AS event_date,
        COUNT(*) AS daily_completions
    FROM abgbproduction_174525b3_gdpr.client_events_view_level_summary ls
    CROSS JOIN date_bounds db
    WHERE ls.processdate BETWEEN db.rolling_start_pd AND db.end_date_pd
      AND ls.game_mode = 'saga' AND ls.exit_screen = 'completed'
    GROUP BY 1, 2
),
rolling_7d AS (
    SELECT player_id, event_date,
        AVG(daily_completions) OVER (PARTITION BY player_id ORDER BY CAST(event_date AS TIMESTAMP)
            RANGE BETWEEN INTERVAL '6' DAY PRECEDING AND CURRENT ROW) AS avg_completions_7d
    FROM daily_completions
),
active_player_days AS (
    SELECT d.event_date, d.player_id,
        CASE
            WHEN r.avg_completions_7d IS NULL OR r.avg_completions_7d = 0 THEN 'A. 0'
            WHEN r.avg_completions_7d < 10  THEN 'B. 1-9'
            WHEN r.avg_completions_7d < 20  THEN 'C. 10-19'
            WHEN r.avg_completions_7d < 40  THEN 'D. 20-39'
            WHEN r.avg_completions_7d < 100 THEN 'E. 40-99'
            ELSE 'F. 100+'
        END AS engagement_segment
    FROM abgbproduction_174525b3_gdpr.player_daily d
    LEFT JOIN abgbproduction_174525b3_reporting.orphans o ON d.player_id = o.player_id
    LEFT JOIN rolling_7d r ON d.player_id = r.player_id AND d.event_date = r.event_date
    CROSS JOIN date_bounds db
    WHERE d.event_date BETWEEN db.start_date AND db.end_date
      AND o.player_id IS NULL AND d.max_level IS NOT NULL AND TRY_CAST(d.max_level AS INTEGER) > 200
      AND COALESCE(r.avg_completions_7d, 0) > 0
),
lifetime_payers AS (
    SELECT DISTINCT player_id FROM abgbproduction_174525b3_reporting.active_players_daily
    WHERE cumulative_money_spent > 0
),
seg_daily AS (
    SELECT ap.player_id, ap.event_date,
        CASE ap.engagement_segment WHEN 'A. 0' THEN '0-9' WHEN 'B. 1-9' THEN '0-9'
            WHEN 'C. 10-19' THEN '10-19' WHEN 'D. 20-39' THEN '20-39'
            WHEN 'E. 40-99' THEN '40-99' WHEN 'F. 100+' THEN '100+' END AS segment,
        CASE ap.engagement_segment WHEN 'A. 0' THEN 1 WHEN 'B. 1-9' THEN 1 WHEN 'C. 10-19' THEN 2
            WHEN 'D. 20-39' THEN 3 WHEN 'E. 40-99' THEN 4 WHEN 'F. 100+' THEN 5 END AS seg_rank
    FROM active_player_days ap
),
-- Kite instances (multi-day, within window).
kite_inst AS (
    SELECT event_id, MIN(start_date) AS start_date, MAX(end_date) AS end_date,
        date_diff('day', MIN(start_date), MAX(end_date)) + 1 AS n_days
    FROM (
        SELECT c.m_event_id AS event_id,
            DATE(FROM_UNIXTIME_NANOS(CAST(RPAD(c.m_start_time, 19, '0') AS BIGINT))) AS start_date,
            DATE(FROM_UNIXTIME_NANOS(CAST(RPAD(c.m_end_time,   19, '0') AS BIGINT))) AS end_date
        FROM abgbproduction_174525b3_gdpr.client_events c
        CROSS JOIN date_bounds db
        WHERE c.eventtype = 'event_start'
          AND c.processdate BETWEEN db.start_date_pd AND db.end_date_pd
          AND c.processdate >= 20250728
          AND c.m_event_name = 'KiteFestival'
    ) s
    GROUP BY event_id
    HAVING MIN(start_date) <> MAX(end_date)
       AND MIN(start_date) >= (SELECT start_date FROM params)
       AND MAX(end_date)   <= (SELECT end_date   FROM params)
),
-- Per-submission incremental score (LAG over cumulative m_score_reached), with date.
kite_sub AS (
    SELECT c.player_id, c.m_event_id AS event_id,
        DATE(date_parse(CAST(c.processdate AS VARCHAR), '%Y%m%d')) AS event_date,
        CAST(c.m_score_reached AS INTEGER)
          - COALESCE(LAG(CAST(c.m_score_reached AS INTEGER))
              OVER (PARTITION BY c.player_id, c.m_event_id ORDER BY CAST(c.m_score_reached AS INTEGER)), 0)
            AS score_inc,
        MAX(CAST(c.m_score_reached AS INTEGER))
              OVER (PARTITION BY c.player_id, c.m_event_id) AS total_score
    FROM abgbproduction_174525b3_gdpr.client_events c
    CROSS JOIN date_bounds db
    WHERE c.eventtype = 'event_action'
      AND c.m_event_name = 'KiteFestival'
      AND c.processdate BETWEEN db.start_date_pd AND db.end_date_pd
),
-- Per (instance, player, date): score earned that day + event-day index + total.
kday AS (
    SELECT i.event_id, ks.player_id, ks.event_date,
        date_diff('day', i.start_date, ks.event_date) + 1 AS event_day, i.n_days,
        SUM(ks.score_inc)   AS day_score,
        MAX(ks.total_score) AS total_score
    FROM kite_sub ks
    JOIN kite_inst i ON i.event_id = ks.event_id AND ks.event_date BETWEEN i.start_date AND i.end_date
    GROUP BY 1, 2, 3, 4, 5
),
-- Participant totals (denominator); participant = positive total score.
ptot AS (
    SELECT event_id, player_id, n_days, MAX(total_score) AS total_score
    FROM kday GROUP BY 1, 2, 3 HAVING MAX(total_score) > 0
),
-- Modal segment per (instance, participant) over the days they submitted.
pseg AS (
    SELECT event_id, player_id, segment, seg_rank, payer_flag
    FROM (
        SELECT d.event_id, d.player_id, d.segment, d.seg_rank,
            CASE WHEN lp.player_id IS NOT NULL THEN 'PAYER' ELSE 'NONPAYER' END AS payer_flag,
            ROW_NUMBER() OVER (PARTITION BY d.event_id, d.player_id ORDER BY d.cnt DESC, d.seg_rank DESC) AS rn
        FROM (
            SELECT k.event_id, k.player_id, sd.segment, sd.seg_rank, COUNT(*) AS cnt
            FROM kday k JOIN seg_daily sd ON sd.player_id = k.player_id AND sd.event_date = k.event_date
            GROUP BY 1, 2, 3, 4
        ) d
        LEFT JOIN lifetime_payers lp ON lp.player_id = d.player_id
    )
    WHERE rn = 1
),
scaffold AS (
    SELECT p.event_id, p.player_id, k AS event_day
    FROM ptot p CROSS JOIN UNNEST(sequence(1, p.n_days)) AS seq(k)
),
cum AS (
    SELECT sc.event_id, sc.player_id, sc.event_day,
        SUM(COALESCE(k.day_score, 0)) OVER (PARTITION BY sc.event_id, sc.player_id
            ORDER BY sc.event_day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_score
    FROM scaffold sc
    LEFT JOIN kday k ON k.event_id = sc.event_id AND k.player_id = sc.player_id AND k.event_day = sc.event_day
),
cum_share AS (
    SELECT 'Kite Festival' AS event_name, ps.segment, ps.seg_rank, ps.payer_flag, c.event_day,
        c.event_id, c.player_id,
        1.0 * c.cum_score / NULLIF(pt.total_score, 0) AS score_share
    FROM cum c
    JOIN ptot pt ON pt.event_id = c.event_id AND pt.player_id = c.player_id
    JOIN pseg ps ON ps.event_id = c.event_id AND ps.player_id = c.player_id
)
SELECT
    event_name, payer_flag, segment, seg_rank, event_day,
    MAX(n_days_for_event)                          AS instance_length_days,
    COUNT(DISTINCT event_id)                       AS n_instances,
    COUNT(DISTINCT player_id)                      AS n_participants,
    ROUND(AVG(score_share), 4)                     AS cum_token_share_mean,
    ROUND(APPROX_PERCENTILE(score_share, 0.50), 4) AS cum_token_share_p50,
    ROUND(APPROX_PERCENTILE(score_share, 0.25), 4) AS cum_token_share_p25,
    ROUND(APPROX_PERCENTILE(score_share, 0.75), 4) AS cum_token_share_p75,
    CAST(NULL AS DOUBLE)                           AS cum_levels_share_mean
FROM (
    SELECT cs.*, i.n_days AS n_days_for_event
    FROM cum_share cs JOIN kite_inst i ON i.event_id = cs.event_id
)
GROUP BY event_name, payer_flag, segment, seg_rank, event_day
ORDER BY event_name, seg_rank, payer_flag, event_day;