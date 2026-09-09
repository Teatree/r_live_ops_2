-- =============================================================================
-- win_streaks_31d_v1.sql
-- Export refresh triggers: {{ refresh_all_request_id_input }}
-- WITHIN-DAY SAGA WIN-STREAK BEHAVIOUR
-- Grain: segment x payer  ·  Window: inclusive shared Start date–End date inputs
-- =============================================================================
WITH params AS (
    SELECT CAST({{ gains_ab_start_date_input }} AS DATE) AS start_date,
           CAST({{ gains_ab_end_date_input }} AS DATE) AS end_date
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
      AND ls.game_mode = 'saga'
      AND ls.exit_screen = 'completed'
    GROUP BY 1, 2
),
rolling_7d AS (
    SELECT player_id, event_date,
        AVG(daily_completions) OVER (
            PARTITION BY player_id
            ORDER BY CAST(event_date AS TIMESTAMP)
            RANGE BETWEEN INTERVAL '6' DAY PRECEDING AND CURRENT ROW
        ) AS avg_completions_7d
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
        END AS seg_rank,
        CASE WHEN lp.player_id IS NOT NULL THEN 'PAYER' ELSE 'NONPAYER' END AS payer_flag
    FROM active_player_days ap
    LEFT JOIN lifetime_payers lp ON lp.player_id = ap.player_id
),
attempts_ordered AS (
    SELECT ls.player_id,
        ls.event_date,
        ROW_NUMBER() OVER (PARTITION BY ls.player_id, ls.event_date ORDER BY ls.o_ts, ls.level_max, ls.level_attempts) AS attempt_seq,
        CASE WHEN ls.exit_screen = 'completed' THEN 1 ELSE 0 END AS is_win
    FROM abgbproduction_174525b3_gdpr.client_events_view_level_summary ls
    CROSS JOIN date_bounds db
    WHERE ls.processdate BETWEEN db.start_date_pd AND db.end_date_pd
      AND ls.game_mode = 'saga'
      AND ls.t_geo NOT IN ('FI','PL')
),
attempts_with_prev AS (
    SELECT player_id, event_date, attempt_seq, is_win,
        LAG(is_win) OVER (PARTITION BY player_id, event_date ORDER BY attempt_seq) AS prev_is_win
    FROM attempts_ordered
),
attempts_grouped AS (
    SELECT player_id, event_date, attempt_seq, is_win, prev_is_win,
        SUM(CASE WHEN is_win = 0 THEN 1 ELSE 0 END) OVER (
            PARTITION BY player_id, event_date
            ORDER BY attempt_seq
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS streak_group
    FROM attempts_with_prev
),
player_day AS (
    SELECT sd.segment, sd.payer_flag, sd.seg_rank, sd.player_id, sd.event_date,
        COUNT(*) AS attempts,
        SUM(is_win) AS wins,
        SUM(CASE WHEN prev_is_win = 1 THEN 1 ELSE 0 END) AS prev_win_next_attempts,
        SUM(CASE WHEN prev_is_win = 1 AND is_win = 1 THEN 1 ELSE 0 END) AS continued_after_win
    FROM attempts_grouped a
    JOIN seg_daily sd ON sd.player_id = a.player_id AND sd.event_date = a.event_date
    GROUP BY 1, 2, 3, 4, 5
),
streak_lengths AS (
    SELECT sd.segment, sd.payer_flag, sd.seg_rank, a.player_id, a.event_date, a.streak_group,
        COUNT(*) AS streak_len
    FROM attempts_grouped a
    JOIN seg_daily sd ON sd.player_id = a.player_id AND sd.event_date = a.event_date
    WHERE a.is_win = 1
    GROUP BY 1, 2, 3, 4, 5, 6
),
player_day_max AS (
    SELECT pd.segment, pd.payer_flag, pd.seg_rank, pd.player_id, pd.event_date,
        pd.attempts, pd.wins, pd.prev_win_next_attempts, pd.continued_after_win,
        COALESCE(MAX(sl.streak_len), 0) AS max_streak_per_day
    FROM player_day pd
    LEFT JOIN streak_lengths sl
        ON sl.player_id = pd.player_id
       AND sl.event_date = pd.event_date
       AND sl.segment = pd.segment
       AND sl.payer_flag = pd.payer_flag
    GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
),
streak_avg AS (
    SELECT segment, payer_flag, seg_rank, AVG(CAST(streak_len AS DOUBLE)) AS mean_streak_len
    FROM streak_lengths
    GROUP BY 1, 2, 3
)
SELECT
    pd.segment,
    pd.payer_flag,
    pd.seg_rank,
    COUNT(DISTINCT pd.player_id) AS players,
    COUNT(*) AS player_days,
    ROUND(AVG(CAST(pd.attempts AS DOUBLE)), 4) AS attempts_per_day_mean,
    ROUND(AVG(CAST(pd.wins AS DOUBLE)), 4) AS wins_per_day_mean,
    ROUND(SUM(pd.wins) * 1.0 / NULLIF(SUM(pd.attempts), 0), 4) AS win_rate_mean,
    APPROX_PERCENTILE(pd.max_streak_per_day, 0.25) AS max_streak_per_day_p25,
    APPROX_PERCENTILE(pd.max_streak_per_day, 0.50) AS max_streak_per_day_p50,
    APPROX_PERCENTILE(pd.max_streak_per_day, 0.75) AS max_streak_per_day_p75,
    APPROX_PERCENTILE(pd.max_streak_per_day, 0.90) AS max_streak_per_day_p90,
    ROUND(sa.mean_streak_len, 4) AS mean_streak_len,
    ROUND(SUM(pd.continued_after_win) * 1.0 / NULLIF(SUM(pd.prev_win_next_attempts), 0), 4) AS p_continue_after_win
FROM player_day_max pd
LEFT JOIN streak_avg sa ON sa.segment = pd.segment AND sa.payer_flag = pd.payer_flag
GROUP BY pd.segment, pd.payer_flag, pd.seg_rank, sa.mean_streak_len
ORDER BY pd.seg_rank, pd.payer_flag
