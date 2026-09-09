-- =============================================================================
-- Export refresh triggers: {{ refresh_all_request_id_input }} {{ refresh_data_event_inst_request_id_input }}
-- EVENT PARTICIPATION / OPT-IN / LEADERBOARD POSITION
-- Grain: event x segment x payer  ·  Window: Apr 29–May 31 2026 (33d)
--
-- OUTPUT  (sheet `data_event_inst`)
-- Each row = one (event, segment, payer) cohort: participation, opt-in, milestone-reach and finishing-position stats pooled across that event's instances in the window (1-day events included).
--
--   event_name                      canonical event name
--   payer_flag                      NONPAYER / PAYER
--   segment                         segment tier
--   seg_rank                        segment sort key
--   n_instances                     instances of this event in the window
--   active_window_player_instances  active (player x instance) rows = the denominator
--   avg_participants_per_instance   participants / n_instances
--   participation_rate              participants / active-window population
--   opt_in_rate                     exposed (got event_start) / active-window population
--   recipient_rate                  participants unlocking >=1 milestone reward / participants
--   position_p25/p50/p75            final leaderboard position among participants (lower = better)
--   avg_final_token_balance         mean end-of-event token balance (participants)
--   avg_bots                        mean bots on the board (context for position)
--
-- LOUD FLAGS
--  Includes single-day events (no multi-day filter). EXCLUDES Team
--  (event_complete path) and Kite (score path). Pooled across instances;
--  n_instances reported separately. [C1]-[C6] of data_event_accrual apply.
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
-- Instances (all leaderboard events within window; single AND multi day).
inst AS (
    SELECT event_id, MAX(event_name) AS event_name,
        MIN(start_date) AS start_date, MAX(end_date) AS end_date,
        date_diff('day', MIN(start_date), MAX(end_date)) + 1 AS n_days
    FROM (
        SELECT c.m_event_id AS event_id,
            CASE WHEN c.m_event_name = 'ArcheryArena' THEN 'Target Day'
                 WHEN c.m_event_name = 'MusicBoxes'   THEN 'Bombs Ballet'
                 WHEN c.m_event_name = 'FlockRush'    THEN 'Flock Flurry'
                 ELSE ARRAY_JOIN(REGEXP_EXTRACT_ALL(c.m_event_name, '[A-Z]{1}[a-z]+'), ' ') END AS event_name,
            DATE(FROM_UNIXTIME_NANOS(CAST(RPAD(c.m_start_time, 19, '0') AS BIGINT))) AS start_date,
            DATE(FROM_UNIXTIME_NANOS(CAST(RPAD(c.m_end_time,   19, '0') AS BIGINT))) AS end_date
        FROM abgbproduction_174525b3_gdpr.client_events c
        CROSS JOIN date_bounds db
        WHERE c.eventtype = 'event_start'
          AND c.processdate BETWEEN db.start_date_pd AND db.end_date_pd
          AND c.processdate >= 20250728
          AND c.m_event_name NOT IN ('RollingOffer','DreamPeak','WinStreak','SuperBomb',
                                     'ProgressOffer','LevelRace','Level Race','KiteFestival')
          AND c.m_event_name NOT LIKE 'Team%'
    ) s
    GROUP BY event_id
    HAVING MIN(start_date) >= (SELECT start_date FROM params)
       AND MAX(end_date)   <= (SELECT end_date   FROM params)
),
-- Exposed (opt-in): one row per (instance, player) that received an event_start.
exposed AS (
    SELECT DISTINCT c.m_event_id AS event_id, c.player_id
    FROM abgbproduction_174525b3_gdpr.client_events c
    CROSS JOIN date_bounds db
    WHERE c.eventtype = 'event_start'
      AND c.processdate BETWEEN db.start_date_pd AND db.end_date_pd
),
-- End-state per (instance, player): final rank / milestone / token balance / bots.
ends AS (
    SELECT c.m_event_id AS event_id, c.player_id,
        MAX(TRY_CAST(c.m_leaderboard_position     AS INTEGER)) AS position,
        MAX(TRY_CAST(c.m_milestone_reward_unlocked AS INTEGER)) AS milestones,
        MAX(TRY_CAST(c.m_token_balance            AS DOUBLE))  AS token_balance,
        MAX(TRY_CAST(c.m_bots_amount              AS INTEGER)) AS bots
    FROM abgbproduction_174525b3_gdpr.client_events c
    CROSS JOIN date_bounds db
    WHERE c.eventtype = 'event_end'
      AND c.processdate BETWEEN db.start_date_pd AND db.end_date_pd
    GROUP BY 1, 2
),
-- Participants: earned >=1 event token during the instance window.
parts AS (
    SELECT i.event_id, dl.player_id
    FROM (
        SELECT ls.player_id, ls.event_date, a.event_id, SUM(ls.event_tokens[a.event_name]) AS tokens
        FROM abgbproduction_174525b3_gdpr.client_events_view_level_summary ls
        CROSS JOIN UNNEST(ls.active_event_ids) AS a(event_name, event_id)
        CROSS JOIN date_bounds db
        WHERE ls.processdate BETWEEN db.start_date_pd AND db.end_date_pd
          AND ls.exit_screen = 'completed'
        GROUP BY 1, 2, 3
    ) dl
    JOIN inst i ON i.event_id = dl.event_id AND dl.event_date BETWEEN i.start_date AND i.end_date
    WHERE dl.tokens > 0
    GROUP BY 1, 2
),
-- Active-during-window population per (instance, player) + modal segment (denominator).
aw AS (
    SELECT event_id, event_name, player_id, segment, seg_rank, payer_flag
    FROM (
        SELECT d.event_id, d.event_name, d.player_id, d.segment, d.seg_rank,
               CASE WHEN lp.player_id IS NOT NULL THEN 'PAYER' ELSE 'NONPAYER' END AS payer_flag,
               ROW_NUMBER() OVER (PARTITION BY d.event_id, d.player_id ORDER BY d.cnt DESC, d.seg_rank DESC) AS rn
        FROM (
            SELECT i.event_id, i.event_name, sd.player_id, sd.segment, sd.seg_rank, COUNT(*) AS cnt
            FROM seg_daily sd
            JOIN inst i ON sd.event_date BETWEEN i.start_date AND i.end_date
            GROUP BY 1, 2, 3, 4, 5
        ) d
        LEFT JOIN lifetime_payers lp ON lp.player_id = d.player_id
    )
    WHERE rn = 1
),
-- Master: active-window players flagged by exposed / participant + end-state.
master AS (
    SELECT aw.event_name, aw.segment, aw.seg_rank, aw.payer_flag, aw.event_id, aw.player_id,
        IF(e.player_id IS NOT NULL, 1, 0) AS is_exposed,
        IF(p.player_id IS NOT NULL, 1, 0) AS is_participant,
        en.position, en.milestones, en.token_balance, en.bots
    FROM aw
    LEFT JOIN exposed e ON e.event_id = aw.event_id AND e.player_id = aw.player_id
    LEFT JOIN parts   p ON p.event_id = aw.event_id AND p.player_id = aw.player_id
    LEFT JOIN ends   en ON en.event_id = aw.event_id AND en.player_id = aw.player_id
)
SELECT
    event_name, payer_flag, segment, seg_rank,
    COUNT(DISTINCT event_id)                                              AS n_instances,
    COUNT(*)                                                              AS active_window_player_instances,
    ROUND(SUM(is_participant) * 1.0 / COUNT(DISTINCT event_id), 0)        AS avg_participants_per_instance,
    ROUND(AVG(is_participant), 4)                                         AS participation_rate,
    ROUND(AVG(is_exposed), 4)                                             AS opt_in_rate,
    ROUND(SUM(IF(is_participant = 1 AND milestones > 0, 1, 0)) * 1.0
          / NULLIF(SUM(is_participant), 0), 4)                           AS recipient_rate,
    APPROX_PERCENTILE(IF(is_participant = 1, position, NULL), 0.25)       AS position_p25,
    APPROX_PERCENTILE(IF(is_participant = 1, position, NULL), 0.50)       AS position_p50,
    APPROX_PERCENTILE(IF(is_participant = 1, position, NULL), 0.75)       AS position_p75,
    ROUND(AVG(IF(is_participant = 1, token_balance, NULL)), 1)            AS avg_final_token_balance,
    ROUND(AVG(IF(is_participant = 1, CAST(bots AS DOUBLE), NULL)), 0)     AS avg_bots
FROM master
GROUP BY event_name, payer_flag, segment, seg_rank
ORDER BY event_name, seg_rank, payer_flag;