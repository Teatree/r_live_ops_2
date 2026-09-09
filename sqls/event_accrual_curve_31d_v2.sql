-- =============================================================================
-- event_accrual_curve_31d_v2.sql
-- Export refresh triggers: {{ refresh_all_request_id_input }} {{ refresh_data_event_accrual_request_id_input }}
-- WITHIN-EVENT REWARD-ACCRUAL CURVE (token events)
-- Grain: event x segment x payer x event-day  ·  Window: inclusive shared Start date–End date inputs
--
-- v2 adds Level Race. For Level Race, tokens = saga levels completed inside the
-- active_event_ids instance window; measured instances are ~1 day and may saturate immediately.
-- =============================================================================
WITH params AS (
    SELECT CAST({{ gains_ab_start_date_input }} AS DATE) AS start_date,
           CAST({{ gains_ab_end_date_input }} AS DATE) AS end_date,
           50 AS min_resource_earners, 0.0 AS min_pct_of_pool
),
date_bounds AS (
    SELECT start_date, end_date,
        CAST(date_format(start_date - INTERVAL '6' DAY, '%Y%m%d') AS INTEGER) AS rolling_start_pd,
        CAST(date_format(start_date, '%Y%m%d') AS INTEGER) AS start_date_pd,
        CAST(date_format(end_date, '%Y%m%d') AS INTEGER) AS end_date_pd
    FROM params
),
ab_groups AS (
    SELECT player_id, MAX(variant_name) AS ab_group, MIN(join_date) AS join_date
    FROM experiment_results.player_aggregate_snapshot
    WHERE app_id  = 'abgbproduction_174525b3'
      AND rule_id = {{ gains_ab_rule_id_input }}
      AND snapshot_date = (
          SELECT MAX(event_date)
          FROM experiment_results.metrics
          WHERE app_id  = 'abgbproduction_174525b3'
            AND rule_id = {{ gains_ab_rule_id_input }}
      )
      AND variant_name = {{ gains_ab_groups_input }}
    GROUP BY player_id

    UNION ALL

    SELECT DISTINCT d.player_id, 'All players' AS ab_group, DATE '1970-01-01' AS join_date
    FROM abgbproduction_174525b3_gdpr.player_daily d
    CROSS JOIN date_bounds db
    WHERE NULLIF(TRIM(CAST({{ gains_ab_rule_id_input }} AS VARCHAR)), '') IS NULL
      AND d.event_date BETWEEN db.start_date AND db.end_date
),
nightsky_variant AS (
    SELECT DISTINCT player_id
    FROM experiment_results.player_aggregate_snapshot
    WHERE app_id  = 'abgbproduction_174525b3'
      AND rule_id = '912013a5-f76b-49b1-87bb-1a2546bb5a73'
      AND LOWER(variant_name) LIKE 'variant%'
      AND snapshot_date = (
          SELECT MAX(event_date)
          FROM experiment_results.metrics
          WHERE app_id  = 'abgbproduction_174525b3'
            AND rule_id = '912013a5-f76b-49b1-87bb-1a2546bb5a73'
      )
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
            WHEN r.avg_completions_7d < 10 THEN 'B. 1-9'
            WHEN r.avg_completions_7d < 20 THEN 'C. 10-19'
            WHEN r.avg_completions_7d < 40 THEN 'D. 20-39'
            WHEN r.avg_completions_7d < 100 THEN 'E. 40-99'
            ELSE 'F. 100+'
        END AS engagement_segment
    FROM abgbproduction_174525b3_gdpr.player_daily d
    INNER JOIN ab_groups ab
        ON d.player_id = ab.player_id
       AND d.event_date >= ab.join_date
    LEFT JOIN nightsky_variant ns ON d.player_id = ns.player_id
    LEFT JOIN reporting.orphans o
        ON d.player_id = o.player_id AND o.app_id = 'abgbproduction_174525b3'
    LEFT JOIN rolling_7d r ON d.player_id = r.player_id AND d.event_date = r.event_date
    CROSS JOIN date_bounds db
    WHERE d.event_date BETWEEN db.start_date AND db.end_date
      AND ns.player_id IS NULL
      AND o.player_id IS NULL
      AND COALESCE(r.avg_completions_7d, 0) > 0
),
lifetime_payers AS (
    SELECT DISTINCT a.player_id
    FROM reporting.active_players_daily a
    CROSS JOIN date_bounds db
    WHERE a.app_id = 'abgbproduction_174525b3'
      AND a.event_date BETWEEN db.start_date AND db.end_date
      AND a.cumulative_money_spent > 0
),
seg_daily AS (
    SELECT ap.player_id, ap.event_date,
        CASE ap.engagement_segment
            WHEN 'A. 0' THEN '0-9' WHEN 'B. 1-9' THEN '0-9' WHEN 'C. 10-19' THEN '10-19'
            WHEN 'D. 20-39' THEN '20-39' WHEN 'E. 40-99' THEN '40-99' WHEN 'F. 100+' THEN '100+'
        END AS segment,
        CASE ap.engagement_segment
            WHEN 'A. 0' THEN 1 WHEN 'B. 1-9' THEN 1 WHEN 'C. 10-19' THEN 2
            WHEN 'D. 20-39' THEN 3 WHEN 'E. 40-99' THEN 4 WHEN 'F. 100+' THEN 5
        END AS seg_rank
    FROM active_player_days ap
),
inst AS (
    SELECT event_id, MAX(event_name) AS event_name,
        MIN(start_date) AS start_date, MAX(end_date) AS end_date,
        date_diff('day', MIN(start_date), MAX(end_date)) + 1 AS n_days,
        MAX(competition_type) AS competition_type, MAX(rounds_total) AS rounds_total
    FROM (
        SELECT c.m_event_id AS event_id,
            CASE WHEN c.m_event_name = 'ArcheryArena' THEN 'Target Day'
                 WHEN c.m_event_name = 'MusicBoxes' THEN 'Bombs Ballet'
                 WHEN c.m_event_name = 'FlockRush' THEN 'Flock Flurry'
                 ELSE ARRAY_JOIN(REGEXP_EXTRACT_ALL(c.m_event_name, '[A-Z]{1}[a-z]+'), ' ') END AS event_name,
            DATE(FROM_UNIXTIME_NANOS(CAST(RPAD(c.m_start_time, 19, '0') AS BIGINT))) AS start_date,
            DATE(FROM_UNIXTIME_NANOS(CAST(RPAD(c.m_end_time, 19, '0') AS BIGINT))) AS end_date,
            c.m_event_competition_type AS competition_type,
            TRY_CAST(c.m_rounds_total AS INT) AS rounds_total
        FROM abgbproduction_174525b3_gdpr.client_events c
        CROSS JOIN date_bounds db
        WHERE c.eventtype = 'event_start'
          AND c.processdate BETWEEN db.start_date_pd AND db.end_date_pd
          AND c.processdate >= 20250728
          AND c.m_event_name NOT IN ('RollingOffer','DreamPeak','WinStreak','SuperBomb',
                                     'ProgressOffer','KiteFestival')
          AND c.m_event_name NOT LIKE 'Team%'
    ) s
    GROUP BY event_id
    HAVING MIN(start_date) <> MAX(end_date)
       AND MIN(start_date) >= (SELECT start_date FROM params)
       AND MAX(end_date) <= (SELECT end_date FROM params)
),
daily_levels AS (
    SELECT ls.event_date, ls.player_id, a.event_id,
        COUNT(DISTINCT IF(
            CASE WHEN a.event_name = 'LevelRace' THEN ls.game_mode = 'saga' AND ls.exit_screen = 'completed'
                 ELSE ls.event_tokens[a.event_name] > 0 END,
            IF(ls.game_mode = 'saga', ls.level_max, ls.event_level_index), NULL)) AS levels_during_event,
        SUM(CASE WHEN a.event_name = 'LevelRace' AND ls.game_mode = 'saga' AND ls.exit_screen = 'completed'
                 THEN 1.0 ELSE COALESCE(ls.event_tokens[a.event_name], 0) END) AS tokens
    FROM abgbproduction_174525b3_gdpr.client_events_view_level_summary ls
    CROSS JOIN UNNEST(ls.active_event_ids) AS a(event_name, event_id)
    CROSS JOIN date_bounds db
    WHERE ls.processdate BETWEEN db.start_date_pd AND db.end_date_pd
      AND ls.exit_screen = 'completed'
      AND a.event_name NOT IN ('WinStreakRefreshed','SuperBomb','RollingOffer','DreamPeak')
    GROUP BY 1, 2, 3
),
ptoks AS (
    SELECT i.event_id, i.event_name, i.n_days, dl.player_id, dl.event_date,
        date_diff('day', i.start_date, dl.event_date) + 1 AS event_day,
        COALESCE(dl.tokens, 0) AS tokens,
        COALESCE(dl.levels_during_event, 0) AS levels
    FROM daily_levels dl
    JOIN inst i ON i.event_id = dl.event_id AND dl.event_date BETWEEN i.start_date AND i.end_date
),
ptot AS (
    SELECT event_id, event_name, n_days, player_id, SUM(tokens) AS total_tokens, SUM(levels) AS total_levels
    FROM ptoks
    GROUP BY 1, 2, 3, 4
    HAVING SUM(tokens) > 0
),
pseg AS (
    SELECT event_id, player_id, segment, seg_rank, payer_flag
    FROM (
        SELECT d.event_id, d.player_id, d.segment, d.seg_rank,
            CASE WHEN lp.player_id IS NOT NULL THEN 'PAYER' ELSE 'NONPAYER' END AS payer_flag,
            ROW_NUMBER() OVER (PARTITION BY d.event_id, d.player_id ORDER BY d.cnt DESC, d.seg_rank DESC) AS rn
        FROM (
            SELECT t.event_id, t.player_id, sd.segment, sd.seg_rank, COUNT(*) AS cnt
            FROM ptoks t
            JOIN seg_daily sd ON sd.player_id = t.player_id AND sd.event_date = t.event_date
            GROUP BY 1, 2, 3, 4
        ) d
        LEFT JOIN lifetime_payers lp ON lp.player_id = d.player_id
    )
    WHERE rn = 1
),
scaffold AS (
    SELECT p.event_id, p.event_name, p.player_id, k AS event_day
    FROM ptot p
    CROSS JOIN UNNEST(sequence(1, p.n_days)) AS seq(k)
),
cum AS (
    SELECT sc.event_id, sc.event_name, sc.player_id, sc.event_day,
        SUM(COALESCE(t.tokens, 0)) OVER (PARTITION BY sc.event_id, sc.player_id
            ORDER BY sc.event_day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_tokens,
        SUM(COALESCE(t.levels, 0)) OVER (PARTITION BY sc.event_id, sc.player_id
            ORDER BY sc.event_day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_levels
    FROM scaffold sc
    LEFT JOIN ptoks t ON t.event_id = sc.event_id AND t.player_id = sc.player_id AND t.event_day = sc.event_day
),
cum_share AS (
    SELECT c.event_name, ps.segment, ps.seg_rank, ps.payer_flag, c.event_day,
        c.event_id, c.player_id,
        1.0 * c.cum_tokens / NULLIF(pt.total_tokens, 0) AS token_share,
        CASE WHEN pt.total_levels > 0 THEN 1.0 * c.cum_levels / pt.total_levels END AS levels_share
    FROM cum c
    JOIN ptot pt ON pt.event_id = c.event_id AND pt.player_id = c.player_id
    JOIN pseg ps ON ps.event_id = c.event_id AND ps.player_id = c.player_id
)
SELECT
    event_name,
    payer_flag,
    segment,
    seg_rank,
    event_day,
    MAX(n_days_for_event) AS instance_length_days,
    COUNT(DISTINCT event_id) AS n_instances,
    COUNT(DISTINCT player_id) AS n_participants,
    ROUND(AVG(token_share), 4) AS cum_token_share_mean,
    ROUND(APPROX_PERCENTILE(token_share, 0.50), 4) AS cum_token_share_p50,
    ROUND(APPROX_PERCENTILE(token_share, 0.25), 4) AS cum_token_share_p25,
    ROUND(APPROX_PERCENTILE(token_share, 0.75), 4) AS cum_token_share_p75,
    ROUND(AVG(levels_share), 4) AS cum_levels_share_mean
FROM (
    SELECT cs.*, i.n_days AS n_days_for_event
    FROM cum_share cs
    JOIN inst i ON i.event_id = cs.event_id
)
GROUP BY event_name, payer_flag, segment, seg_rank, event_day
ORDER BY event_name, seg_rank, payer_flag, event_day
