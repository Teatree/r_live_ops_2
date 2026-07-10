-- =============================================================================
-- RESOURCE SOURCE MIX — PERIOD ROLLUP  (% + ACTUAL AMOUNT of each currency/item by category)
-- -----------------------------------------------------------------------------
-- Over one editable window (default = all of May 2026): for each segment and each
-- RESOURCE (HC + every booster + unlimited lives), what % of that resource's total
-- free gains came from each source category, plus the ACTUAL amounts.
--
-- Edit the window in `params` (start_date / end_date, both inclusive).
--
-- Aggregating over the period IS the availability handling: an event that ran a
-- few days contributes exactly its real slice of the period's pool; dark days add
-- nothing; residual post-event claims add their small real amount to the right
-- category. No per-day presence filter needed here.
--
-- "earners" of a resource = players who earned >0 of THAT resource in the period
--   (counted within each segment-day they occupied).
-- Metrics (each %-pair sums to ~100% across categories within a resource):
--   pct_of_resource_pool       = cat amount / resource pool over period (whale-weighted)
--   mean_share_all_earners_pct = mean over all earners of their personal % from this
--                                category over the period, zeros included (equal-weighted)
-- Actual amounts (in the resource's native unit — see `unit`: HC / count / minutes):
--   category_amount      = total free gains of this resource from this category
--   resource_pool_amount = total free gains of this resource (all categories)
--   amount_per_earner    = category_amount / resource_earners
--   amount_per_recipient = category_amount / recipients
--
-- FREE only: HC = m_amount_cur_free; items = m_action <> 'purchase'.
-- SPT pending (placeholder CTE below).
-- =============================================================================

WITH params AS (
    SELECT
        DATE '2026-05-01' AS start_date,        -- << editable: period start (inclusive)
        DATE '2026-05-31' AS end_date,          -- << editable: period end   (inclusive)
        50   AS min_resource_earners,           -- << drop (segment, resource) cells with too few earners
        0.0  AS min_pct_of_pool                 -- << optional: hide categories below this % of the pool (0 = show all)
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
    WHERE ls.processdate BETWEEN db.rolling_start_pd AND db.end_date_pd
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
),

-- PER-PLAYER-DAY gains (one row per player x day x source_detail x resource) ----
-- 1) FREE HC
hc_pp AS (
    SELECT
        ap.event_date, ap.engagement_segment, ap.player_id,
        COALESCE(NULLIF(ce.m_action_sub1, ''), ce.m_action) AS source_detail,
        'HC' AS resource, 'HC' AS unit,
        CAST(SUM(COALESCE(IF(TRY_CAST(ce.m_amount_cur_free AS INTEGER) BETWEEN 0 AND 9999,
                             TRY_CAST(ce.m_amount_cur_free AS DOUBLE)), 0)) AS DOUBLE) AS amount
    FROM active_player_days ap
    INNER JOIN abgbproduction_174525b3_gdpr.client_events ce
        ON ce.player_id = ap.player_id
       AND CAST(date_parse(CAST(ce.processdate AS VARCHAR), '%Y%m%d') AS DATE) = ap.event_date
    CROSS JOIN date_bounds db
    WHERE ce.processdate BETWEEN db.start_date_pd AND db.end_date_pd
      AND ce.eventtype = 'currency_gain'
      AND ce.t_geo NOT IN ('FI','PL')
    GROUP BY 1, 2, 3, 4
),
-- 2) Consumable boosters (count) -- free only
consumables_pp AS (
    SELECT
        ap.event_date, ap.engagement_segment, ap.player_id,
        COALESCE(NULLIF(ce.m_action_sub1, ''), ce.m_action) AS source_detail,
        CASE ce.m_item
            WHEN 'pre_level_booster_1' THEN 'Red'
            WHEN 'pre_level_booster_2' THEN 'Chuck'
            WHEN 'pre_level_booster_3' THEN 'Bomb'
            WHEN 'powerup_1'           THEN 'Comet'
            WHEN 'powerup_2'           THEN 'Slingshot'
            WHEN 'powerup_3'           THEN 'Shuffle'
        END AS resource,
        'count' AS unit,
        CAST(SUM(TRY_CAST(ce.m_amount_item AS BIGINT)) AS DOUBLE) AS amount
    FROM active_player_days ap
    INNER JOIN abgbproduction_174525b3_gdpr.client_events ce
        ON ce.player_id = ap.player_id
       AND CAST(date_parse(CAST(ce.processdate AS VARCHAR), '%Y%m%d') AS DATE) = ap.event_date
    CROSS JOIN date_bounds db
    WHERE ce.processdate BETWEEN db.start_date_pd AND db.end_date_pd
      AND ce.eventtype = 'item_gain'
      AND ce.m_action <> 'purchase'
      AND ce.t_geo NOT IN ('FI','PL')
      AND ce.m_item IN ('pre_level_booster_1','pre_level_booster_2','pre_level_booster_3',
                        'powerup_1','powerup_2','powerup_3')
      AND TRY_CAST(ce.m_amount_item AS INTEGER) BETWEEN 0 AND 99
    GROUP BY 1, 2, 3, 4, 5
),
-- 3) Unlimited boosters (minutes) -- free only, DEDUPED
ul_booster_raw AS (
    SELECT
        CAST(date_parse(CAST(ce.processdate AS VARCHAR), '%Y%m%d') AS DATE) AS event_date,
        ce.player_id,
        COALESCE(NULLIF(ce.m_action_sub1, ''), ce.m_action) AS source_detail,
        CASE ce.m_item
            WHEN 'UnlimitedBooster1' THEN 'UL Red'
            WHEN 'UnlimitedBooster2' THEN 'UL Chuck'
            WHEN 'UnlimitedBooster3' THEN 'UL Bomb'
        END AS resource,
        TRY_CAST(ce.m_amount_item AS BIGINT) AS minutes,
        ROW_NUMBER() OVER (PARTITION BY ce.o_ts, ce.m_item, ce.m_amount_item,
                                        ce.player_id, ce.m_item_category, ce.m_action) AS n_rows
    FROM abgbproduction_174525b3_gdpr.client_events ce
    CROSS JOIN date_bounds db
    WHERE ce.processdate BETWEEN db.start_date_pd AND db.end_date_pd
      AND ce.eventtype       = 'item_gain'
      AND ce.m_item_category = 'ul_pre_booster'
      AND ce.m_action       <> 'purchase'
      AND ce.t_geo NOT IN ('FI','PL')
      AND TRY_CAST(ce.m_amount_item AS INTEGER) > 0
),
ul_pp AS (
    SELECT
        ap.event_date, ap.engagement_segment, ap.player_id,
        r.source_detail, r.resource, 'minutes' AS unit,
        CAST(SUM(r.minutes) AS DOUBLE) AS amount
    FROM ul_booster_raw r
    INNER JOIN active_player_days ap
        ON ap.player_id = r.player_id AND ap.event_date = r.event_date
    WHERE r.n_rows = 1
    GROUP BY 1, 2, 3, 4, 5
),
-- 4) Unlimited lives (minutes) -- free only (NOT deduped, matches your lives query)
lives_pp AS (
    SELECT
        ap.event_date, ap.engagement_segment, ap.player_id,
        COALESCE(NULLIF(ce.m_action_sub1, ''), ce.m_action) AS source_detail,
        'Unlimited Lives' AS resource, 'minutes' AS unit,
        CAST(SUM(TRY_CAST(ce.m_amount_item AS BIGINT)) AS DOUBLE) AS amount
    FROM active_player_days ap
    INNER JOIN abgbproduction_174525b3_gdpr.client_events ce
        ON ce.player_id = ap.player_id
       AND CAST(date_parse(CAST(ce.processdate AS VARCHAR), '%Y%m%d') AS DATE) = ap.event_date
    CROSS JOIN date_bounds db
    WHERE ce.processdate BETWEEN db.start_date_pd AND db.end_date_pd
      AND ce.eventtype       = 'item_gain'
      AND ce.m_item_category = 'unlimited_lives'
      AND ce.m_action       <> 'purchase'
      AND ce.t_geo NOT IN ('FI','PL')
      AND TRY_CAST(ce.m_amount_item AS INTEGER) > 0
    GROUP BY 1, 2, 3, 4
),
-- 5) SPT / SPTx2 — DELIVERED 2026-07-10: the Query LLM's own run pushed 'SPT' and 'SPTx2'
--    rows into data_gains (workbook (10)); the two are distinct resources there (SPTx2 = the
--    double-value token; the engine weights it x2 for season-pass tier progression, D16).
--    ⚠ The exact m_item identifiers used in that run are NOT recorded in this repo — this block
--    stays commented until they're confirmed with the Query LLM; re-running this file today
--    would silently DROP the SPT rows the workbook already has. Shape as delivered:
-- spt_pp AS (
--     SELECT ap.event_date, ap.engagement_segment, ap.player_id,
--            COALESCE(NULLIF(ce.m_action_sub1,''), ce.m_action) AS source_detail,
--            'SPT' AS resource, 'count' AS unit,                       -- 'SPTx2' in the twin CTE
--            CAST(SUM(TRY_CAST(ce.m_amount_item AS BIGINT)) AS DOUBLE) AS amount
--     FROM active_player_days ap
--     INNER JOIN abgbproduction_174525b3_gdpr.client_events ce
--         ON ce.player_id = ap.player_id
--        AND CAST(date_parse(CAST(ce.processdate AS VARCHAR),'%Y%m%d') AS DATE) = ap.event_date
--     CROSS JOIN date_bounds db
--     WHERE ce.processdate BETWEEN db.start_date_pd AND db.end_date_pd
--       AND ce.eventtype='item_gain' AND ce.m_item='<<SPT_ITEM_ID_AS_DELIVERED>>'
--       AND ce.m_action<>'purchase' AND ce.t_geo NOT IN ('FI','PL')
--     GROUP BY 1,2,3,4
-- ),
-- sptx2_pp AS ( ... same shape, m_item='<<SPTX2_ITEM_ID_AS_DELIVERED>>', resource 'SPTx2' ),

gains_pp AS (
    SELECT * FROM hc_pp
    UNION ALL SELECT * FROM consumables_pp
    UNION ALL SELECT * FROM ul_pp
    UNION ALL SELECT * FROM lives_pp
    -- UNION ALL SELECT * FROM spt_pp
    -- UNION ALL SELECT * FROM sptx2_pp
),

-- Map to category; collapse to player x resource x category OVER THE PERIOD -----
ppc AS (
    SELECT
        engagement_segment, resource, unit, player_id,
        CASE
            WHEN source_detail = 'red_event'                                          THEN 'Red Challenge'
            WHEN source_detail = 'chuck_event'                                        THEN 'Chuck Challenge'
            WHEN source_detail = 'bomb_event'                                         THEN 'Bomb Challenge'
            WHEN source_detail = 'solo_race_event'                                    THEN 'Flash Race'
            WHEN source_detail IN ('season_pass_event','SeasonPass','SeasonPassHoliday',
                                   'SeasonPassHalloween','SeasonPassSummer','dream_pass_event')
                                                                                     THEN 'Season Pass (Free)'
            WHEN source_detail = 'FlowerCoop'                                         THEN 'FlowerCoop'
            WHEN source_detail = 'Hatchling Hideaway'                                 THEN 'Hatchling Hideaway'
            WHEN source_detail IN ('bomb_ballet_event','MusicBoxes')                  THEN 'Bomb''s Ballet'
            WHEN source_detail IN ('Jigsaw','PuzzleValentine')                        THEN 'Jigsaw'
            WHEN source_detail IN ('Photoshoot','MakeupHarvest','MakeupEaster')       THEN 'Photoshoot'
            WHEN source_detail = 'kite_festival_event'                                THEN 'Kite Festival'
            WHEN source_detail IN ('dreamheist_event','treasure_dive_event')          THEN 'Daily Night Sky Prize'
            WHEN source_detail = 'ArcheryArena'                                       THEN 'Target Day'
            WHEN source_detail = 'river_rush'                                         THEN 'River Rush'
            WHEN source_detail = 'FlockRush'                                          THEN 'Flock Flurry'
            WHEN source_detail = 'team_collection'                                    THEN 'Team Event'
            WHEN source_detail IN ('team_versus','team_versus_contribution','race_event')
                                                                                     THEN 'Team Race'
            WHEN source_detail IN ('daily_reward','day_1','day_2','day_3','day_4',
                                   'day_5','day_6','day_7','gift')                    THEN 'Daily Gift'
            WHEN source_detail = 'Rainbow Maker'                                      THEN 'Rainbow Maker'
            WHEN source_detail IN ('chapter_complete','PlayerLevelUpChest','SagaPath')
                 OR source_detail LIKE 'SagaChestRewards%'                            THEN 'Core'
            WHEN source_detail = 'RewardVideo.Chest'                                  THEN 'Ads'
            WHEN source_detail = 'shop_purchase'                                      THEN 'IAPs'
            ELSE 'Other'
        END AS category,
        SUM(amount) AS amount
    FROM gains_pp
    GROUP BY 1, 2, 3, 4, 5
    HAVING SUM(amount) > 0
),

-- Per player x resource: whole-period total of that resource (share denominator)
prt AS (
    SELECT engagement_segment, resource, unit, player_id, SUM(amount) AS amount_total
    FROM ppc
    GROUP BY 1, 2, 3, 4
),

-- Per segment x resource: earners + pool over the period -----------------------
rt AS (
    SELECT engagement_segment, resource, unit,
           COUNT(*)          AS resource_earners,
           SUM(amount_total) AS resource_pool
    FROM prt
    GROUP BY 1, 2, 3
),

-- Per-player whole-period share within resource --------------------------------
shares AS (
    SELECT
        c.engagement_segment, c.resource, c.unit, c.category, c.player_id,
        c.amount,
        1.0 * c.amount / t.amount_total AS share
    FROM ppc c
    JOIN prt t
        ON  c.engagement_segment = t.engagement_segment
        AND c.resource           = t.resource
        AND c.player_id          = t.player_id
)

SELECT
    s.engagement_segment,
    s.resource,
    s.unit,
    s.category,

    rt.resource_earners,
    COUNT(*)                                                       AS recipients,
    ROUND(100.0 * COUNT(*) / rt.resource_earners, 2)              AS recipient_rate_pct,

    -- where this resource's period gains come from (each ~sums to 100% per resource)
    ROUND(100.0 * SUM(s.amount) / rt.resource_pool, 2)           AS pct_of_resource_pool,
    ROUND(100.0 * SUM(s.share)  / rt.resource_earners, 2)        AS mean_share_all_earners_pct,

    -- ACTUAL amounts (in the resource's native unit; see `unit`) -------------
    ROUND(SUM(s.amount), 2)                                       AS category_amount,
    ROUND(rt.resource_pool, 2)                                    AS resource_pool_amount,
    ROUND(SUM(s.amount) / rt.resource_earners, 4)                AS amount_per_earner,
    ROUND(SUM(s.amount) / COUNT(*), 4)                           AS amount_per_recipient
FROM shares s
JOIN rt
    ON  s.engagement_segment = rt.engagement_segment
    AND s.resource           = rt.resource
CROSS JOIN params p
GROUP BY 1, 2, 3, 4, rt.resource_earners, rt.resource_pool, p.min_resource_earners, p.min_pct_of_pool
HAVING rt.resource_earners >= p.min_resource_earners
   AND 100.0 * SUM(s.amount) / rt.resource_pool >= p.min_pct_of_pool
ORDER BY s.engagement_segment, s.resource, pct_of_resource_pool DESC;