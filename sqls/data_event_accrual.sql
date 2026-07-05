-- =============================================================================
-- Export refresh triggers: {{ refresh_all_request_id_input }} {{ refresh_data_event_accrual_request_id_input }}
-- WITHIN-EVENT REWARD-ACCRUAL CURVE (token events) — the duration multiplier
-- Grain: event x segment x payer x event-day  ·  Window: Apr 29–May 31 2026 (33d)
--
-- OUTPUT  (sheet `data_event_accrual`)
-- Each row = one (event, segment, payer, event-day): the cumulative fraction of a participant's EVENTUAL per-instance reward (proxied by tokens) accrued by the end of that event-day. To shorten an event, read the share at event_day = new duration (River Rush 7->3 => event_day 3).
--
--   event_name                   canonical event name
--   payer_flag                   NONPAYER / PAYER
--   segment                      segment tier
--   seg_rank                     segment sort key
--   event_day                    day index within the instance (1 = first day)
--   instance_length_days         N days of the instance
--   n_instances                  instances pooled
--   n_participants               distinct participants in the cohort
--   cum_token_share_mean         mean cumulative token share by this day  <- the multiplier
--   cum_token_share_p50/p25/p75  distribution of that share
--   cum_levels_share_mean        secondary effort proxy (cum event-levels / total); token-gated [C6]
--
-- LOUD FLAGS
--  [C1] MULTI-DAY ONLY. The `start_date <> end_date` filter keeps events that
--       currently run multiple days (a curve only exists if N>1). This is the
--       RIGHT scope: it KEEPS River Rush (7d) and Flock Flurry (multi-day) and
--       DROPS the currently-1-day events. The 1-day events that get LONGER in the
--       redesign — Challenges (1->2) and Flash Race (1->3) — have NO measurable
--       curve here; their duration uplift is the EXTRAPOLATION case (§8: cap
--       conservatively and flag), NOT something this query can produce. Do not
--       read a multiplier for them from this output.
--  [C2] KITE FESTIVAL is EXCLUDED. Kite is score-submission, not token-based
--       (eventtype='event_action', m_event_name='KiteFestival', m_score_reached),
--       so event_tokens[] is empty for it and it yields no participants here.
--       Kite's 7->3 curve needs the score-LAG accrual path from kitefestival_query
--       — a separate companion query (noted at end). TEAM events are also excluded
--       (separate m_event_start_time / event_complete path).
--  [C3] INSTANCES FULLY WITHIN THE WINDOW. To keep the curve consistent with the
--       May segmentation (which only covers May), instances are required to start
--       AND end within [start_date,end_date]. Instances straddling the Jun
--       boundary are dropped (avoids a truncated tail + missing segment days).
--       For ~7-day events this keeps the ~3-4 instances that sit inside the month.
--  [C4] "reward share" here = TOKEN share. The ACTUAL per-resource reward
--       (HC/boosters/UL) per instance, recipient_rate, participation/opt-in, and
--       the leaderboard-POSITION distribution are §7c Part 2 (different grain:
--       per-instance x resource / x position) — separate file, same CTE spine.
--  [C5] event_id is the instance join key (name-agnostic). Canonical names use the
--       same CASE mapping as the project's event examples (FlockRush->Flock Flurry;
--       CamelCase split otherwise => RiverRush->River Rush). Confirm the exact
--       m_event_name strings for any event whose canonical label looks off via
--       SELECT DISTINCT m_event_name (Challenges/Flash Race raw names are not in
--       the project text — but they're 1-day and excluded here anyway [C1]).
--  [C6] levels-share (cum event-levels played / total) is a secondary effort
--       proxy alongside token-share; it is token-gated (counts only levels that
--       earned event tokens), so it is meaningful only for token events.
--
-- Athena/Trino, schema abgbproduction_174525b3_gdpr, runnable via pyathena.
-- No FROM_UNIXTIME_NANOS in the final SELECT (wrapped in DATE() inside CTEs);
-- no ARBITRARY on raw nanos (DATE-convert per row, then MIN/MAX); processdate
-- cast to INTEGER for pruning; no COUNT(DISTINCT) inside window functions.
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

-- Lifetime payer flag (window-stable) ------------------------------------------
lifetime_payers AS (
    SELECT DISTINCT player_id
    FROM abgbproduction_174525b3_reporting.active_players_daily
    WHERE cumulative_money_spent > 0
),

-- Per-player-day segment (relabelled to 5 canonical segments) ------------------
seg_daily AS (
    SELECT
        ap.player_id, ap.event_date,
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

-- Event INSTANCES from event_start (multi-day leaderboard events within window).
-- DATE-convert nanos per row, then MIN/MAX (deterministic; avoids ARBITRARY/nanos).
inst AS (
    SELECT
        event_id,
        MAX(event_name)              AS event_name,
        MIN(start_date)              AS start_date,
        MAX(end_date)                AS end_date,
        date_diff('day', MIN(start_date), MAX(end_date)) + 1 AS n_days,
        MAX(competition_type)        AS competition_type,
        MAX(rounds_total)            AS rounds_total
    FROM (
        SELECT
            c.m_event_id AS event_id,
            CASE WHEN c.m_event_name = 'ArcheryArena' THEN 'Target Day'
                 WHEN c.m_event_name = 'MusicBoxes'   THEN 'Bombs Ballet'
                 WHEN c.m_event_name = 'FlockRush'    THEN 'Flock Flurry'
                 ELSE ARRAY_JOIN(REGEXP_EXTRACT_ALL(c.m_event_name, '[A-Z]{1}[a-z]+'), ' ') END AS event_name,
            DATE(FROM_UNIXTIME_NANOS(CAST(RPAD(c.m_start_time, 19, '0') AS BIGINT))) AS start_date,
            DATE(FROM_UNIXTIME_NANOS(CAST(RPAD(c.m_end_time,   19, '0') AS BIGINT))) AS end_date,
            c.m_event_competition_type AS competition_type,
            TRY_CAST(c.m_rounds_total AS INT) AS rounds_total
        FROM abgbproduction_174525b3_gdpr.client_events c
        CROSS JOIN date_bounds db
        WHERE c.eventtype = 'event_start'
          AND c.processdate BETWEEN db.start_date_pd AND db.end_date_pd
          AND c.processdate >= 20250728                              -- data before this date has bugs
          AND c.m_event_name NOT IN ('RollingOffer','DreamPeak','WinStreak','SuperBomb',
                                     'ProgressOffer','LevelRace','Level Race','KiteFestival')  -- [C2]
          AND c.m_event_name NOT LIKE 'Team%'                        -- [C2] team = separate path
    ) s
    GROUP BY event_id
    HAVING MIN(start_date) <> MAX(end_date)                          -- [C1] multi-day only
       AND MIN(start_date) >= (SELECT start_date FROM params)        -- [C3] fully within window
       AND MAX(end_date)   <= (SELECT end_date   FROM params)
),

-- Per (event_id, player, date) event-token accrual from the level-summary view.
daily_levels AS (
    SELECT
        ls.event_date,
        ls.player_id,
        a.event_id,
        COUNT(DISTINCT IF(ls.event_tokens[a.event_name] > 0,
                          IF(ls.game_mode = 'saga', ls.level_max, ls.event_level_index))) AS levels_during_event,
        SUM(ls.event_tokens[a.event_name]) AS tokens
    FROM abgbproduction_174525b3_gdpr.client_events_view_level_summary ls
    CROSS JOIN UNNEST(ls.active_event_ids) AS a(event_name, event_id)
    CROSS JOIN date_bounds db
    WHERE ls.processdate BETWEEN db.start_date_pd AND db.end_date_pd
      AND ls.exit_screen = 'completed'
      AND a.event_name NOT IN ('WinStreakRefreshed','SuperBomb','RollingOffer','DreamPeak')
    GROUP BY 1, 2, 3
),

-- Restrict accrual to the instance window; index event-day within the instance.
ptoks AS (
    SELECT
        i.event_id, i.event_name, i.n_days,
        dl.player_id, dl.event_date,
        date_diff('day', i.start_date, dl.event_date) + 1 AS event_day,
        COALESCE(dl.tokens, 0)              AS tokens,
        COALESCE(dl.levels_during_event, 0) AS levels
    FROM daily_levels dl
    JOIN inst i
      ON i.event_id = dl.event_id
     AND dl.event_date BETWEEN i.start_date AND i.end_date
),

-- Participant totals (eventual reward denominator). Participant = earned tokens.
ptot AS (
    SELECT event_id, event_name, n_days, player_id,
           SUM(tokens) AS total_tokens,
           SUM(levels) AS total_levels
    FROM ptoks
    GROUP BY 1, 2, 3, 4
    HAVING SUM(tokens) > 0
),

-- Modal segment per (instance, participant) over the days they played.
pseg AS (
    SELECT event_id, player_id, segment, seg_rank, payer_flag
    FROM (
        SELECT
            d.event_id, d.player_id, d.segment, d.seg_rank,
            CASE WHEN lp.player_id IS NOT NULL THEN 'PAYER' ELSE 'NONPAYER' END AS payer_flag,
            ROW_NUMBER() OVER (PARTITION BY d.event_id, d.player_id
                               ORDER BY d.cnt DESC, d.seg_rank DESC) AS rn
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

-- Full 1..N day scaffold per participant (so cumulative is defined on idle days).
scaffold AS (
    SELECT p.event_id, p.event_name, p.player_id, k AS event_day
    FROM ptot p
    CROSS JOIN UNNEST(sequence(1, p.n_days)) AS seq(k)
),

-- Cumulative tokens / levels by event-day per participant.
cum AS (
    SELECT
        sc.event_id, sc.event_name, sc.player_id, sc.event_day,
        SUM(COALESCE(t.tokens, 0)) OVER (PARTITION BY sc.event_id, sc.player_id
            ORDER BY sc.event_day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_tokens,
        SUM(COALESCE(t.levels, 0)) OVER (PARTITION BY sc.event_id, sc.player_id
            ORDER BY sc.event_day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_levels
    FROM scaffold sc
    LEFT JOIN ptoks t
      ON t.event_id = sc.event_id AND t.player_id = sc.player_id AND t.event_day = sc.event_day
),

-- Per-participant share at each event-day.
cum_share AS (
    SELECT
        c.event_name, ps.segment, ps.seg_rank, ps.payer_flag, c.event_day,
        c.event_id, c.player_id,
        1.0 * c.cum_tokens / NULLIF(pt.total_tokens, 0) AS token_share,
        CASE WHEN pt.total_levels > 0 THEN 1.0 * c.cum_levels / pt.total_levels END AS levels_share
    FROM cum c
    JOIN ptot pt ON pt.event_id = c.event_id AND pt.player_id = c.player_id
    JOIN pseg ps ON ps.event_id = c.event_id AND ps.player_id = c.player_id
)

-- ===================== OUTPUT: accrual curve per event x segment x event_day ==
SELECT
    event_name,
    payer_flag,
    segment,
    seg_rank,
    event_day,
    MAX(n_days_for_event)                                   AS instance_length_days,
    COUNT(DISTINCT event_id)                                AS n_instances,
    COUNT(DISTINCT player_id)                               AS n_participants,
    ROUND(AVG(token_share),  4)                             AS cum_token_share_mean,
    ROUND(APPROX_PERCENTILE(token_share, 0.50), 4)          AS cum_token_share_p50,
    ROUND(APPROX_PERCENTILE(token_share, 0.25), 4)          AS cum_token_share_p25,
    ROUND(APPROX_PERCENTILE(token_share, 0.75), 4)          AS cum_token_share_p75,
    ROUND(AVG(levels_share), 4)                             AS cum_levels_share_mean
FROM (
    SELECT cs.*, i.n_days AS n_days_for_event
    FROM cum_share cs
    JOIN inst i ON i.event_id = cs.event_id
)
GROUP BY event_name, payer_flag, segment, seg_rank, event_day
ORDER BY event_name, seg_rank, payer_flag, event_day;