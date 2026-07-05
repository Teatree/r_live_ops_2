-- =============================================================================
-- Export refresh triggers: {{ refresh_all_request_id_input }} {{ refresh_data_seg_beh_request_id_input }}
-- SEGMENT BEHAVIOUR / RETENTION — 33-day activity profile per cohort
-- Grain: segment x payer  ·  Window: Apr 29–May 31 2026 (33d)
--
-- OUTPUT  (sheet `data_seg_beh`)
-- Each row = one (segment, payer) cohort's activity & retention profile over the 33-day window: population, play frequency, day-of-week shape, streaks, and per-active-day rates.
--
--   segment                            7d-saga-completion tier (this build: 0-9 / 10-19 / ... / 100+)
--   payer_flag                         NONPAYER / PAYER (lifetime)
--   seg_rank                           segment sort key
--   unique_players                     distinct players in the cohort (by modal segment)
--   player_days                        active player-days in the window
--   dau                                player_days / 33
--   payer_rate_pct                     % of the segment that is PAYER (repeats across both payer rows)
--   active_days_mean/p25/p50/p75/p90   active days per player over 33d (distribution)
--   weekday_active_rate                prob. a member is active on a given weekday date
--   weekend_active_rate                prob. a member is active on a given weekend date
--   mon..sun_active_rate               same probability, per day of week
--   login_streak_mean/p50/p75/p90      longest consecutive-active-day run per player (distribution)
--   sessions_per_active_day            NULL placeholder — see [F1]
--   saga_completes_per_active_day      saga levels completed per active day
--   levels_played_per_active_day       all levels entered per active day
--   levels_completed_per_active_day    all levels completed per active day (cross-check)
--   minutes_per_active_day             minutes played per active day
--   daily_gift_claim_rate_pct          % of active days the daily gift was claimed
--   gift_hc_free_per_active_day        free HC from the daily gift per active day
--   daily_max_streak_mean/p50/p75/p90  in-day saga win-streak (distribution; NS/Kite input)
--
-- LOUD FLAGS
--  [F1] sessions_per_active_day = NULL PLACEHOLDER. player_daily exposes no
--       session column and no session event is confirmed in any project query.
--       Resolve with `SHOW COLUMNS FROM ...player_daily` (look for a sessions /
--       session_count / num_sessions field) OR a session-start event id, then
--       fill the commented `sessions` CTE. Until then this column is NULL by
--       design — no fabricated value. (Same treatment as the pending SPT id.)
--  [F2] TWO GRAINS in one row (intentional, flagged):
--        - per-active-day RATES (saga/levels/minutes/gift/daily_max_streak):
--          pooled by the segment OF THAT ACTIVE PLAYER-DAY, ratio-of-sums,
--          consistent with how data_gains pools.  Denominator = player_days.
--        - PLAYER-LEVEL distributions (active_days, login streak, payer_rate,
--          unique_players): each player assigned to ONE modal in-window segment
--          (the segment holding the most of their active days; ties -> higher
--          engagement). Denominator = unique_players.
--       Segments are sticky over 7-day windows so day-seg and modal-seg coincide
--       for the large majority of player-days; for first-order sim arithmetic
--       (rate x active_days) the residual mismatch is within model tolerance.
--  [F3] GEO: t_geo NOT IN ('FI','PL') is applied only on the client_events
--       (daily-gift) pull — matching the anchor. player_daily / level_summary
--       denominators include FI/PL (documented accepted minor bias: numerator
--       excludes FI/PL on the events side, denominator does not).
--  [F4] PAYER = lifetime payer (active_players_daily.cumulative_money_spent > 0),
--       a window-stable per-player flag (matches both segmentation examples).
--       For an in-window payer definition instead, swap lifetime_payers for a
--       per-window `money_spent>0` flag (commented note at the CTE).
--  [F5] levels_played_per_active_day = player_daily.level_attempts (ALL modes,
--       every level entered). saga_completes_per_active_day is saga-only (from
--       the level_summary view). levels_completed_per_active_day added as a
--       cross-check. Daily-gift claim = any daily-gift gain row that day (D2-D6
--       are item/0-HC, so the flag uses currency_gain OR item_gain).
--  [F6] login_streak = longest run of consecutive active CALENDAR days per
--       player in the window (gaps-and-islands on active dates); this is the
--       Daily-Gift cycle-reset driver, NOT the in-day saga win-streak.
--       login_streak_mean is the per-player max-run mean; daily_max_streak_* is
--       the in-day saga streak distribution used by NS/Kite.
--  [F7] Sheet labels say "30 days"; the measurement window is 33 days (Apr 29–May 31).
--       active_days_* are out of 33. dow_*_active_rate let the workbook rebuild
--       attendance strings for any horizon (PlayerBehavior currently 28-day).
--
-- Athena/Trino, schema abgbproduction_174525b3_gdpr, runnable via pyathena.
-- No FROM_UNIXTIME_NANOS / ARBITRARY / COUNT(DISTINCT)-in-window (schema gotchas).
-- =============================================================================
WITH params AS (
    SELECT
        DATE '2026-04-29' AS start_date,        -- << editable: period start (inclusive)
        DATE '2026-05-31' AS end_date,          -- << editable: period end   (inclusive)
        50   AS min_resource_earners,           -- << (unused here; kept verbatim from anchor)
        0.0  AS min_pct_of_pool                 -- << (unused here; kept verbatim from anchor)
),
date_bounds AS (
    SELECT
        start_date,
        end_date,
        CAST(date_format(start_date - INTERVAL '6' DAY, '%Y%m%d') AS INTEGER) AS rolling_start_pd,
        CAST(date_format(start_date,                    '%Y%m%d') AS INTEGER) AS start_date_pd,
        CAST(date_format(end_date,                      '%Y%m%d') AS INTEGER) AS end_date_pd
    FROM params
),

-- Segmentation -----------------------------------------------------------------
daily_completions AS (
    SELECT
        ls.player_id,
        CAST(date_parse(CAST(ls.processdate AS VARCHAR), '%Y%m%d') AS DATE) AS event_date,
        COUNT(*)                                                            AS daily_completions
    FROM abgbproduction_174525b3_gdpr.client_events_view_level_summary ls
    CROSS JOIN date_bounds db
    WHERE ls.processdate BETWEEN db.rolling_start_pd AND db.end_date_pd  -- floored 6d early to seed 7d avg
      AND ls.game_mode   = 'saga'
      AND ls.exit_screen = 'completed'
    GROUP BY 1, 2
),
rolling_7d AS (
    SELECT
        player_id, event_date,
        AVG(daily_completions) OVER (
            PARTITION BY player_id
            ORDER BY CAST(event_date AS TIMESTAMP)
            RANGE BETWEEN INTERVAL '6' DAY PRECEDING AND CURRENT ROW
        ) AS avg_completions_7d
    FROM daily_completions
),
active_player_days AS (
    SELECT
        d.event_date,
        d.player_id,
        CASE
            WHEN r.avg_completions_7d IS NULL OR r.avg_completions_7d = 0 THEN 'A. 0'
            WHEN r.avg_completions_7d < 10                                THEN 'B. 1-9'
            WHEN r.avg_completions_7d < 20                                THEN 'C. 10-19'
            WHEN r.avg_completions_7d < 40                                THEN 'D. 20-39'
            WHEN r.avg_completions_7d < 100                               THEN 'E. 40-99'
            ELSE                                                              'F. 100+'
        END AS engagement_segment
    FROM abgbproduction_174525b3_gdpr.player_daily d
    LEFT JOIN abgbproduction_174525b3_reporting.orphans o
        ON d.player_id = o.player_id
    LEFT JOIN rolling_7d r
        ON d.player_id = r.player_id AND d.event_date = r.event_date
    CROSS JOIN date_bounds db
    WHERE d.event_date BETWEEN db.start_date AND db.end_date
      AND o.player_id IS NULL
      AND d.max_level IS NOT NULL
      AND TRY_CAST(d.max_level AS INTEGER) > 200
      AND COALESCE(r.avg_completions_7d, 0) > 0
),

-- Payer flag (lifetime payer; [F4]). For in-window payers instead, replace with
-- a per-(player) money_spent>0 flag built off player_daily over the window.
lifetime_payers AS (
    SELECT DISTINCT player_id
    FROM abgbproduction_174525b3_reporting.active_players_daily
    WHERE cumulative_money_spent > 0
),

-- Spine: one row per active player-day, excluding A.0 zero-completion days,
-- relabelled to the 5 canonical segments + lifetime payer flag + day-of-week
-- (Trino day_of_week: 1=Mon … 7=Sun). The 0-9 row is therefore B.1-9 only.
spine AS (
    SELECT
        ap.player_id,
        ap.event_date,
        CASE ap.engagement_segment
            WHEN 'A. 0'     THEN '0-9'
            WHEN 'B. 1-9'   THEN '0-9'
            WHEN 'C. 10-19' THEN '10-19'
            WHEN 'D. 20-39' THEN '20-39'
            WHEN 'E. 40-99' THEN '40-99'
            WHEN 'F. 100+'  THEN '100+'
        END AS segment,
        CASE ap.engagement_segment
            WHEN 'A. 0' THEN 1 WHEN 'B. 1-9' THEN 1 WHEN 'C. 10-19' THEN 2
            WHEN 'D. 20-39' THEN 3 WHEN 'E. 40-99' THEN 4 WHEN 'F. 100+' THEN 5
        END AS seg_rank,
        CASE WHEN lp.player_id IS NOT NULL THEN 'PAYER' ELSE 'NONPAYER' END AS payer_flag,
        day_of_week(ap.event_date) AS dow
    FROM active_player_days ap
    LEFT JOIN lifetime_payers lp ON lp.player_id = ap.player_id
),

-- In-day saga win-streak per player-day (TST gaps-and-islands on the view,
-- ordered by o_ts; window-bounded). Used for daily_max_streak distribution.
daily_streak AS (
    SELECT player_id, event_date, MAX(run_length) AS daily_max_streak
    FROM (
        SELECT player_id, event_date, streak_grp, COUNT(*) AS run_length
        FROM (
            SELECT
                ls.player_id,
                ls.event_date,
                CASE WHEN ls.exit_screen = 'completed' THEN 1 ELSE 0 END AS is_complete,
                ROW_NUMBER() OVER (PARTITION BY ls.player_id, ls.event_date ORDER BY ls.o_ts)
                  - ROW_NUMBER() OVER (PARTITION BY ls.player_id, ls.event_date,
                                       CASE WHEN ls.exit_screen = 'completed' THEN 1 ELSE 0 END
                                       ORDER BY ls.o_ts) AS streak_grp
            FROM abgbproduction_174525b3_gdpr.client_events_view_level_summary ls
            CROSS JOIN date_bounds db
            WHERE ls.processdate BETWEEN db.start_date_pd AND db.end_date_pd
              AND ls.game_mode = 'saga'
        )
        WHERE is_complete = 1
        GROUP BY player_id, event_date, streak_grp
    )
    GROUP BY player_id, event_date
),

-- Per-player-day activity metrics from player_daily (window-bounded). 1 row/p-day.
pd_metrics AS (
    SELECT
        d.player_id,
        d.event_date,
        d.level_attempts      AS level_attempts,     -- [F5] all-mode levels played
        d.level_completes     AS level_completes,
        d.time_spent_seconds  AS time_spent_seconds
    FROM abgbproduction_174525b3_gdpr.player_daily d
    CROSS JOIN date_bounds db
    WHERE d.event_date BETWEEN db.start_date AND db.end_date
),

-- Daily-gift claim flag per player-day. Daily-gift source set matches the anchor;
-- D2-D6 are item/0-HC so the flag spans currency_gain OR item_gain. t_geo here [F3].
daily_gift AS (
    SELECT
        ce.player_id,
        CAST(date_parse(CAST(ce.processdate AS VARCHAR), '%Y%m%d') AS DATE) AS event_date,
        1 AS claimed_gift,
        CAST(SUM(CASE WHEN ce.eventtype = 'currency_gain'
                       AND TRY_CAST(ce.m_amount_cur_free AS INTEGER) BETWEEN 0 AND 9999
                      THEN TRY_CAST(ce.m_amount_cur_free AS DOUBLE) ELSE 0 END) AS DOUBLE) AS gift_hc_free
    FROM abgbproduction_174525b3_gdpr.client_events ce
    CROSS JOIN date_bounds db
    WHERE ce.processdate BETWEEN db.start_date_pd AND db.end_date_pd
      AND ce.t_geo NOT IN ('FI','PL')
      AND COALESCE(NULLIF(ce.m_action_sub1, ''), ce.m_action) IN
          ('daily_reward','day_1','day_2','day_3','day_4','day_5','day_6','day_7','gift')
    GROUP BY 1, 2
),

-- ⚠ [F1] sessions_per_active_day source PENDING — placeholder, emits NULL.
-- Candidate A (if player_daily has a session count column):
--   sessions AS (
--     SELECT d.player_id, d.event_date, d.<<SET_SESSIONS_COL>> AS sessions
--     FROM abgbproduction_174525b3_gdpr.player_daily d CROSS JOIN date_bounds db
--     WHERE d.event_date BETWEEN db.start_date AND db.end_date ),
-- Candidate B (count distinct session ids / app_open events from client_events):
--   sessions AS (
--     SELECT ce.player_id,
--            CAST(date_parse(CAST(ce.processdate AS VARCHAR),'%Y%m%d') AS DATE) AS event_date,
--            COUNT(DISTINCT ce.<<SET_SESSION_ID>>) AS sessions
--     FROM abgbproduction_174525b3_gdpr.client_events ce CROSS JOIN date_bounds db
--     WHERE ce.processdate BETWEEN db.start_date_pd AND db.end_date_pd
--       AND ce.eventtype = '<<SET_SESSION_EVENT>>' AND ce.t_geo NOT IN ('FI','PL')
--     GROUP BY 1,2 ),

-- Enriched per active player-day (segment carried = the DAY's segment).
pp AS (
    SELECT
        s.player_id, s.event_date, s.segment, s.seg_rank, s.payer_flag, s.dow,
        COALESCE(dc.daily_completions, 0)  AS saga_completes,
        COALESCE(ds.daily_max_streak, 0)   AS daily_max_streak,
        COALESCE(pm.level_attempts, 0)     AS levels_played,
        COALESCE(pm.level_completes, 0)    AS levels_completed,
        COALESCE(pm.time_spent_seconds, 0) AS time_spent_seconds,
        COALESCE(dg.claimed_gift, 0)       AS claimed_gift,
        COALESCE(dg.gift_hc_free, 0)       AS gift_hc_free
    FROM spine s
    LEFT JOIN daily_completions dc ON dc.player_id = s.player_id AND dc.event_date = s.event_date
    LEFT JOIN daily_streak ds      ON ds.player_id = s.player_id AND ds.event_date = s.event_date
    LEFT JOIN pd_metrics pm        ON pm.player_id = s.player_id AND pm.event_date = s.event_date
    LEFT JOIN daily_gift dg        ON dg.player_id = s.player_id AND dg.event_date = s.event_date
),

-- Date spine of the window -> per-DOW date counts + window length.
date_spine AS (
    SELECT date_add('day', s, db.start_date) AS d
    FROM date_bounds db
    CROSS JOIN UNNEST(sequence(0, date_diff('day', db.start_date, db.end_date))) AS t(s)
),
dow_counts AS (
    SELECT day_of_week(d) AS dow, COUNT(*) AS n_dates FROM date_spine GROUP BY day_of_week(d)
),
window_days AS (
    SELECT COUNT(*) AS days_in_window FROM date_spine
),

-- Modal segment per player (most active days in window; tie -> higher engagement).
player_seg_days AS (
    SELECT player_id, segment, seg_rank, payer_flag, COUNT(*) AS seg_days
    FROM pp GROUP BY 1, 2, 3, 4
),
player_modal AS (
    SELECT player_id, segment, seg_rank, payer_flag
    FROM (
        SELECT player_id, segment, seg_rank, payer_flag,
               ROW_NUMBER() OVER (PARTITION BY player_id
                                  ORDER BY seg_days DESC, seg_rank DESC) AS rn
        FROM player_seg_days
    )
    WHERE rn = 1
),

-- Player-level activity attributed to modal segment (active_days + wk split + dow).
player_activity AS (
    SELECT
        pm.player_id, pm.segment, pm.seg_rank, pm.payer_flag,
        COUNT(*)                                            AS active_days,
        COUNT(CASE WHEN pp.dow BETWEEN 1 AND 5 THEN 1 END)  AS active_weekday_days,
        COUNT(CASE WHEN pp.dow IN (6, 7)      THEN 1 END)   AS active_weekend_days
    FROM pp
    JOIN player_modal pm ON pm.player_id = pp.player_id
    GROUP BY 1, 2, 3, 4
),

-- Longest consecutive-active-CALENDAR-day run per player ([F6]).
login_runs AS (
    SELECT player_id, island, COUNT(*) AS run_length
    FROM (
        SELECT player_id, event_date,
               date_diff('day', DATE '1970-01-01', event_date)
                 - ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY event_date) AS island
        FROM (SELECT DISTINCT player_id, event_date FROM pp)
    )
    GROUP BY player_id, island
),
player_login AS (
    SELECT player_id, MAX(run_length) AS max_login_streak FROM login_runs GROUP BY player_id
),

-- DOW active-day counts at modal grain.
dow_active AS (
    SELECT pm.segment, pm.seg_rank, pm.payer_flag, pp.dow, COUNT(*) AS active_days_on_dow
    FROM pp
    JOIN player_modal pm ON pm.player_id = pp.player_id
    GROUP BY 1, 2, 3, 4
),

-- ===================== AGGREGATIONS =====================
-- (A) Per-active-day RATES + distributions, pooled by DAY-segment (data_gains-style).
agg_day AS (
    SELECT
        pp.segment, pp.seg_rank, pp.payer_flag,
        COUNT(*)                                                       AS player_days,
        ROUND(SUM(pp.saga_completes)   * 1.0 / COUNT(*), 4)            AS saga_completes_per_active_day,
        ROUND(SUM(pp.levels_played)    * 1.0 / COUNT(*), 4)            AS levels_played_per_active_day,
        ROUND(SUM(pp.levels_completed) * 1.0 / COUNT(*), 4)            AS levels_completed_per_active_day,
        ROUND(SUM(pp.time_spent_seconds) / 60.0 / COUNT(*), 4)        AS minutes_per_active_day,
        ROUND(100.0 * SUM(pp.claimed_gift) / COUNT(*), 2)             AS daily_gift_claim_rate_pct,
        ROUND(SUM(pp.gift_hc_free) * 1.0 / COUNT(*), 4)               AS gift_hc_free_per_active_day,
        ROUND(AVG(CAST(pp.daily_max_streak AS DOUBLE)), 2)            AS daily_max_streak_mean,
        APPROX_PERCENTILE(pp.daily_max_streak, 0.50)                  AS daily_max_streak_p50,
        APPROX_PERCENTILE(pp.daily_max_streak, 0.75)                  AS daily_max_streak_p75,
        APPROX_PERCENTILE(pp.daily_max_streak, 0.90)                  AS daily_max_streak_p90,
        CAST(NULL AS DOUBLE)                                          AS sessions_per_active_day  -- [F1]
    FROM pp
    GROUP BY 1, 2, 3
),

-- (B) Player-level distributions, by MODAL segment.
agg_player AS (
    SELECT
        pa.segment, pa.seg_rank, pa.payer_flag,
        COUNT(*)                                            AS unique_players,
        ROUND(AVG(CAST(pa.active_days AS DOUBLE)), 2)       AS active_days_mean,
        APPROX_PERCENTILE(pa.active_days, 0.25)             AS active_days_p25,
        APPROX_PERCENTILE(pa.active_days, 0.50)             AS active_days_p50,
        APPROX_PERCENTILE(pa.active_days, 0.75)             AS active_days_p75,
        APPROX_PERCENTILE(pa.active_days, 0.90)             AS active_days_p90,
        ROUND(AVG(CAST(pl.max_login_streak AS DOUBLE)), 2)  AS login_streak_mean,
        APPROX_PERCENTILE(pl.max_login_streak, 0.50)        AS login_streak_p50,
        APPROX_PERCENTILE(pl.max_login_streak, 0.75)        AS login_streak_p75,
        APPROX_PERCENTILE(pl.max_login_streak, 0.90)        AS login_streak_p90
    FROM player_activity pa
    LEFT JOIN player_login pl ON pl.player_id = pa.player_id
    GROUP BY 1, 2, 3
),

-- Per-segment payer rate (segment property; repeats across the two payer rows).
seg_pop AS (
    SELECT segment, seg_rank,
           COUNT(*)                                          AS players_total,
           COUNT(CASE WHEN payer_flag = 'PAYER' THEN 1 END)  AS players_payer
    FROM player_modal GROUP BY 1, 2
),

-- DOW active-rate = active days on DOW / (unique_players(seg,payer) * n_dates(DOW)).
dow_rate AS (
    SELECT da.segment, da.seg_rank, da.payer_flag, da.dow,
           1.0 * da.active_days_on_dow / NULLIF(ap.unique_players * dc.n_dates, 0) AS dow_rate
    FROM dow_active da
    JOIN agg_player ap ON ap.segment = da.segment AND ap.payer_flag = da.payer_flag
    JOIN dow_counts dc ON dc.dow = da.dow
),
dow_pivot AS (
    SELECT segment, seg_rank, payer_flag,
        ROUND(MAX(CASE WHEN dow = 1 THEN dow_rate END), 4) AS mon_active_rate,
        ROUND(MAX(CASE WHEN dow = 2 THEN dow_rate END), 4) AS tue_active_rate,
        ROUND(MAX(CASE WHEN dow = 3 THEN dow_rate END), 4) AS wed_active_rate,
        ROUND(MAX(CASE WHEN dow = 4 THEN dow_rate END), 4) AS thu_active_rate,
        ROUND(MAX(CASE WHEN dow = 5 THEN dow_rate END), 4) AS fri_active_rate,
        ROUND(MAX(CASE WHEN dow = 6 THEN dow_rate END), 4) AS sat_active_rate,
        ROUND(MAX(CASE WHEN dow = 7 THEN dow_rate END), 4) AS sun_active_rate
    FROM dow_rate GROUP BY 1, 2, 3
),

-- Weekday / weekend active-rate (modal grain).
wkrate AS (
    SELECT
        pa.segment, pa.seg_rank, pa.payer_flag,
        ROUND(1.0 * SUM(pa.active_weekday_days) / NULLIF(COUNT(*) * wd.n_weekday, 0), 4) AS weekday_active_rate,
        ROUND(1.0 * SUM(pa.active_weekend_days) / NULLIF(COUNT(*) * wd.n_weekend, 0), 4) AS weekend_active_rate
    FROM player_activity pa
    CROSS JOIN (
        SELECT SUM(CASE WHEN dow BETWEEN 1 AND 5 THEN n_dates END) AS n_weekday,
               SUM(CASE WHEN dow IN (6, 7)       THEN n_dates END) AS n_weekend
        FROM dow_counts
    ) wd
    GROUP BY 1, 2, 3, wd.n_weekday, wd.n_weekend
)

-- ===================== FINAL OUTPUT (10 rows: 5 segments x payer) =============
SELECT
    ad.segment,
    ad.payer_flag,
    ad.seg_rank,

    -- population weights
    ap.unique_players,
    ad.player_days,
    ROUND(ad.player_days * 1.0 / MAX(wdw.days_in_window), 0)                       AS dau,
    ROUND(100.0 * sp.players_payer / NULLIF(sp.players_total, 0), 2)               AS payer_rate_pct,

    -- 31-day retention overlay (player-level; modal segment)
    ap.active_days_mean,
    ap.active_days_p25, ap.active_days_p50, ap.active_days_p75, ap.active_days_p90,
    wk.weekday_active_rate,
    wk.weekend_active_rate,
    dp.mon_active_rate, dp.tue_active_rate, dp.wed_active_rate, dp.thu_active_rate,
    dp.fri_active_rate, dp.sat_active_rate, dp.sun_active_rate,
    ap.login_streak_mean,
    ap.login_streak_p50, ap.login_streak_p75, ap.login_streak_p90,

    -- per-active-day rates (day-segment pooled)
    ad.sessions_per_active_day,                 -- [F1] NULL placeholder
    ad.saga_completes_per_active_day,
    ad.levels_played_per_active_day,
    ad.levels_completed_per_active_day,
    ad.minutes_per_active_day,
    ad.daily_gift_claim_rate_pct,
    ad.gift_hc_free_per_active_day,

    -- in-day saga win-streak distribution (NS / Kite)
    ad.daily_max_streak_mean,
    ad.daily_max_streak_p50, ad.daily_max_streak_p75, ad.daily_max_streak_p90

FROM agg_day ad
LEFT JOIN agg_player ap ON ap.segment = ad.segment AND ap.payer_flag = ad.payer_flag
LEFT JOIN seg_pop    sp ON sp.segment = ad.segment
LEFT JOIN dow_pivot  dp ON dp.segment = ad.segment AND dp.payer_flag = ad.payer_flag
LEFT JOIN wkrate     wk ON wk.segment = ad.segment AND wk.payer_flag = ad.payer_flag
CROSS JOIN window_days wdw
GROUP BY
    ad.segment, ad.payer_flag, ad.seg_rank,
    ap.unique_players, ad.player_days, sp.players_payer, sp.players_total,
    ap.active_days_mean, ap.active_days_p25, ap.active_days_p50, ap.active_days_p75, ap.active_days_p90,
    wk.weekday_active_rate, wk.weekend_active_rate,
    dp.mon_active_rate, dp.tue_active_rate, dp.wed_active_rate, dp.thu_active_rate,
    dp.fri_active_rate, dp.sat_active_rate, dp.sun_active_rate,
    ap.login_streak_mean, ap.login_streak_p50, ap.login_streak_p75, ap.login_streak_p90,
    ad.sessions_per_active_day, ad.saga_completes_per_active_day,
    ad.levels_played_per_active_day, ad.levels_completed_per_active_day, ad.minutes_per_active_day,
    ad.daily_gift_claim_rate_pct, ad.gift_hc_free_per_active_day,
    ad.daily_max_streak_mean, ad.daily_max_streak_p50, ad.daily_max_streak_p75, ad.daily_max_streak_p90
ORDER BY ad.seg_rank, ad.payer_flag;