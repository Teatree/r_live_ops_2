Event Eco Investigation — Context Document
Context document for the Gymnastics Dream free-HC source investigation conducted May 2026. Intended as a primer for follow-up work in a project setting. Captures methodology decisions, schema/field conventions, queries built, findings, and open questions.

1. Goal
Identify how free HC gain composition has changed in the past 90 days. Specifically:

Where players started gaining more or less HC, by source
Whether changes are tuning-driven (step changes) or behavior-driven (substitution)
How changes affect different engagement and level segments
What's worth investigating further


2. Analytical Preferences (apply to follow-ups in this project)
Segmentation
Engagement segment — based on rolling 7-day average of saga level completes:

0 (no completes in window)
1-9
10-19
20-39
40-99
100+

Defined as AVG(daily_completions) OVER (PARTITION BY player_id ORDER BY event_date RANGE BETWEEN INTERVAL '6' DAY PRECEDING AND CURRENT ROW).
Known quirk preserved across queries: the 7d rolling avg is computed only over days the player completed at least one saga level, NOT over calendar days. So segment captures "intensity on days played," not "intensity in calendar terms."
Level bracket — based on max_level on the given event_date:

1 201-500
2 501-1000
3 1001-6660
4 6661-10000
5 10001-17000
6 17001-20000
7 20000+

Players with max_level <= 200 are excluded (filters new players / tutorial-stage activity).
Filters consistently applied
FilterValueReasonGeo exclusiont_geo NOT IN ('FI','PL')Test marketsOrphansLEFT JOIN orphans, WHERE NULLStandard cleanupSingle-tx amount capm_amount_cur_free BETWEEN 0 AND 9999Drops malformed/test eventsLevel filtermax_level > 200Excludes new playersRefunds / CS grantsNot separately handledIgnored, blended into normal dataCohortActive-each-dayNot fixed cohortCurrencym_amount_cur_free onlyFree HC, not purchasedAggregation grainWeekly defaultDaily too noisy for 90-day trendsNoise thresholdplayer_days >= 50Per (week × segment × bracket) cellSegmentation basisCompletes, not attemptsexit_screen = 'completed'
Metric definition
Primary metric: hc_gain_free_per_player_day = SUM(hc_gain_free) / SUM(player_days) within (week × segment × bracket × source × source_detail). This is a DAILY metric even when reported weekly — it's average HC per player per active day.
Player-days are counted ONCE per (player × event_date × segment × bracket), then summed across source rows. A player-day where someone earned 0 from source X is correctly diluting the average for that source.
Source labeling
Both m_action (source) and m_action_sub1 (source_detail) are preserved as separate columns. When m_action_sub1 = '', the source_detail falls back to m_action. Pattern: CASE WHEN ce.m_action_sub1 = '' THEN ce.m_action ELSE ce.m_action_sub1 END.

3. Schema & Tables Used
TablePurposeabgbproduction_174525b3_gdpr.client_eventsCurrency gain events; eventtype = 'currency_gain'abgbproduction_174525b3_gdpr.client_events_view_level_summarySaga level completes (game_mode = 'saga', exit_screen = 'completed')abgbproduction_174525b3_gdpr.player_dailyDaily player state, including max_levelabgbproduction_174525b3_reporting.active_players_dailyDAU; has cumulative_money_spent for payer splitabgbproduction_174525b3_reporting.orphansPlayers to exclude
Key field conventions (gathered along the way)

processdate is YYYYMMDD integer (used for partition pruning) → CAST(format_datetime(date_var,'YYYYMMdd') AS INT)
m_amount_cur_free (string) requires TRY_CAST AS INTEGER; wrap in BETWEEN 0 AND 9999 to drop malformed
m_amount_cur_total exists but includes purchased HC; use only when explicitly modeling combined HC
m_event_name and m_action_sub1 may both be used for event identification; in our currency_gain query, river_rush sits in m_action_sub1
For River Rush items: m_item (reward index), m_current_round (round number 1-15) per the analytics doc — schema not personally verified yet


4. Queries Built (Reference)
4.1 Main HC source breakdown — last 90 days, weekly, by segment × bracket × source
Window: 90 days back from a fixed end_date (defaulted to 2026-05-17). 6 extra days for rolling-7d buffer.
sqlWITH date_params AS (
    SELECT
        DATE '2026-05-17' - INTERVAL '90' DAY                                          AS start_date,
        DATE '2026-05-17'                                                              AS end_date,
        DATE '2026-05-17' - INTERVAL '96' DAY                                          AS rolling_start,
        CAST(format_datetime(DATE '2026-05-17' - INTERVAL '96' DAY,'YYYYMMdd') AS INT) AS rolling_start_pd,
        CAST(format_datetime(DATE '2026-05-17' - INTERVAL '90' DAY,'YYYYMMdd') AS INT) AS start_date_pd,
        CAST(format_datetime(DATE '2026-05-17','YYYYMMdd') AS INT)                     AS end_date_pd
),
daily_completions AS (
    SELECT
        ls.player_id,
        CAST(date_parse(CAST(ls.processdate AS VARCHAR),'%Y%m%d') AS DATE) AS event_date,
        COUNT(*)                                                           AS daily_completions
    FROM abgbproduction_174525b3_gdpr.client_events_view_level_summary ls
    CROSS JOIN date_params dp
    WHERE ls.processdate BETWEEN dp.rolling_start_pd AND dp.end_date_pd
      AND ls.game_mode   = 'saga'
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
    SELECT
        d.event_date,
        d.player_id,
        CASE
            WHEN r.avg_completions_7d IS NULL THEN '0'
            WHEN r.avg_completions_7d < 10    THEN '1-9'
            WHEN r.avg_completions_7d < 20    THEN '10-19'
            WHEN r.avg_completions_7d < 40    THEN '20-39'
            WHEN r.avg_completions_7d < 100   THEN '40-99'
            ELSE                                   '100+'
        END                                                               AS engagement_segment,
        CASE
            WHEN TRY_CAST(d.max_level AS INTEGER) BETWEEN 201   AND 500   THEN '1 201-500'
            WHEN TRY_CAST(d.max_level AS INTEGER) BETWEEN 501   AND 1000  THEN '2 501-1000'
            WHEN TRY_CAST(d.max_level AS INTEGER) BETWEEN 1001  AND 6660  THEN '3 1001-6660'
            WHEN TRY_CAST(d.max_level AS INTEGER) BETWEEN 6661  AND 10000 THEN '4 6661-10000'
            WHEN TRY_CAST(d.max_level AS INTEGER) BETWEEN 10001 AND 17000 THEN '5 10001-17000'
            WHEN TRY_CAST(d.max_level AS INTEGER) BETWEEN 17001 AND 20000 THEN '6 17001-20000'
            ELSE                                                               '7 20000+'
        END                                                               AS level_bracket
    FROM abgbproduction_174525b3_gdpr.player_daily d
    LEFT JOIN abgbproduction_174525b3_reporting.orphans o
        ON d.player_id = o.player_id
    LEFT JOIN rolling_7d r
        ON d.player_id = r.player_id AND d.event_date = r.event_date
    CROSS JOIN date_params dp
    WHERE d.event_date BETWEEN dp.start_date AND dp.end_date
      AND o.player_id IS NULL
      AND d.max_level IS NOT NULL
      AND TRY_CAST(d.max_level AS INTEGER) > 200
),
weekly_dau AS (
    SELECT
        date_trunc('week', event_date) AS week,
        engagement_segment,
        level_bracket,
        COUNT(*)                       AS player_days,
        COUNT(DISTINCT player_id)      AS unique_players
    FROM active_player_days
    GROUP BY 1, 2, 3
),
hc_gains AS (
    SELECT
        ap.event_date,
        ap.engagement_segment,
        ap.level_bracket,
        ce.m_action      AS source,
        ce.m_action_sub1 AS source_detail,
        SUM(COALESCE(
            IF(TRY_CAST(ce.m_amount_cur_free AS INTEGER) BETWEEN 0 AND 9999,
               TRY_CAST(ce.m_amount_cur_free AS DOUBLE)),
            0
        )) AS hc_gain_free
    FROM active_player_days ap
    INNER JOIN abgbproduction_174525b3_gdpr.client_events ce
        ON ce.player_id = ap.player_id
       AND CAST(date_parse(CAST(ce.processdate AS VARCHAR),'%Y%m%d') AS DATE) = ap.event_date
    CROSS JOIN date_params dp
    WHERE ce.processdate BETWEEN dp.start_date_pd AND dp.end_date_pd
      AND ce.eventtype   = 'currency_gain'
      AND ce.t_geo NOT IN ('FI','PL')
      AND TRY_CAST(ce.m_level_max AS INTEGER) BETWEEN 1 AND 99999
    GROUP BY 1, 2, 3, 4, 5
),
weekly_hc AS (
    SELECT
        date_trunc('week', event_date) AS week,
        engagement_segment,
        level_bracket,
        source,
        source_detail,
        SUM(hc_gain_free)              AS hc_gain_free_total
    FROM hc_gains
    GROUP BY 1, 2, 3, 4, 5
)
SELECT
    CAST(w.week AS VARCHAR)                                          AS week,
    w.engagement_segment,
    w.level_bracket,
    w.source,
    COALESCE(NULLIF(w.source_detail, ''), w.source)                  AS source_detail,
    d.player_days,
    d.unique_players,
    ROUND(w.hc_gain_free_total, 0)                                   AS hc_gain_free_total,
    ROUND(1.0 * w.hc_gain_free_total / NULLIF(d.player_days, 0), 3)  AS hc_gain_free_per_player_day
FROM weekly_hc w
JOIN weekly_dau d
    ON  w.week               = d.week
    AND w.engagement_segment = d.engagement_segment
    AND w.level_bracket      = d.level_bracket
WHERE d.player_days       >= 50
  AND w.hc_gain_free_total > 0
ORDER BY w.week, w.engagement_segment, w.level_bracket, w.hc_gain_free_total DESC;
Output CSV name: Event_Eco_Investigation_2026_05_17.csv. ~18k rows.
4.2 Player HC distribution for a single event window (variabilized)
Variables: {{ start_date }}, {{ end_date }}, {{ source_name }}. Returns count of players in each HC-earned bucket plus min/avg/max/total and pct shares. Bucket boundaries hardcoded:
1-25 / 26-50 / 51-100 / 101-200 / 201-400 / 401-700 / 701-1000 / 1001-1500 / 1501-2000 / 2001-3000 / 3001-5000 / 5000+
(Re-bucket if event payouts differ materially from river_rush scale.)
4.3 River Rush–specific extension: item claims by HC bucket
Splits item claims into rounds 1-9 (one-time progression) vs rounds 10-15 (loop). Joins to Query 4.2's bucketing. Schema guesses to verify:

eventtype for item-claim events — not specified in analytics doc
River Rush identifier may sit in m_event_name OR m_action_sub1 — query uses OR
Field names m_item, m_current_round assumed by convention


5. Key Findings (90 days ending 2026-05-17)
5.1 Aggregate is flat but composition shifted ~6pp
Overall hc_gain_free_per_player_day is essentially flat around 88 across all 13 weeks. But underneath:
CategoryFirst 4 wksLast 4 wksΔprogression36.4% / 31.6 HC/day30.7% / 27.3 HC/day-14% absoluteevents19.6% / 17.0 HC/day25.8% / 22.9 HC/day+35% absoluteteams~14%~14%flatdaily_login~21%~21%flatmilestonesflatflatflatotherflatflatflat
The progression → event shift is the headline.
5.2 dreamheist_event — NEW source, engagement-gated

First HC contribution: week of 03-30 (~0.7)
Gradual ramp through 04-20 (~1.3)
~3x step-up week of 04-27 (~3.4), stable since
Heavily engagement-skewed in last 3 weeks:

0 segment: 0.02 HC/day
1-9: 1.33
10-19: 4.45
20-39: 8.57
40-99: 12.56
100+: 13.62


Level bracket distribution roughly uniform above 500 → it's an engagement gate, not a level gate
Notable plateau: 40-99 (12.56) ≈ 100+ (13.62) — implies a daily/weekly cap that 40-99 already hits. Power users not getting more.

5.3 chapter_complete — biggest absolute decline

Overall: 25.2 → 22.6 HC/day (-10%, -2.6 absolute)
Decline is uniform across all engagement segments AND all level brackets
Pattern: dips correlate with event-spike weeks (03-30 dreamheist soft-launch, 04-27 dreamheist scale-up)
100+ segment lost 34 HC/player/day from chapters alone (261 → 227)
Hypothesis: behavioral substitution (players doing events instead of saga progression during event weeks), not a rewards tuning change. To confirm: check whether saga completes per active player dropped on those same weeks.

5.4 team_versus — clean step-change DOWN around 04-20

Stable ~4.4 HC/day for 9 weeks
Steps to ~3.2 starting week of 04-20 (-27%)
Affects all level brackets and all engagement segments roughly proportionally
20000+ bracket: -3.11 HC/day in absolute terms (biggest single hit; from 12.31 → 9.20)
100+ engagement segment: only -0.86 (insulated by source diversification)
Partial recovery week of 05-11 (3.59) — possibly noise
Strongly suggests a tuning change or feature change shipped around 2026-04-20.

5.5 race_event — clean step-change UP around 04-13

Mirror of team_versus, opposite direction
Stable ~3.4 for 8 weeks → ~4.7 starting week of 04-13 (+30-40%)
All segments/brackets affected proportionally
100+ segment: 20.4 → 23.6 HC/day
20000+ bracket: only +9% (outlier; baseline already high at 5.61)
Strongly suggests a reward tuning increase shipped around 2026-04-13.

5.6 Step-change impact by engagement (race_event + team_versus combined)
Engagementrace_event Δteam_versus ΔNet0+0.09-0.43-0.341-9+0.33-1.04-0.7110-19+1.59-1.40+0.1920-39+2.67-1.55+1.1240-99+3.33-1.32+2.01100++3.18-0.86+2.32
Key observation: the 100+ engagement segment came out net positive (+2.32) from both changes combined. The 0 and 1-9 segments came out negative. Mid-to-high engagement benefitted most; low engagement was made worse off by the paired changes.
5.7 PlayerLevelUpChest — modest decline, aligned with chapter_complete

100+ engagement segment: 113 → 99 HC/day (-12%)
Consistent with the substitution hypothesis for chapter_complete (players progressing less = fewer level-ups)

5.8 Source disparity analysis (last 4 weeks, ranking by absolute gap)
Top sources by absolute HC/player/day gap between 100+ and 1-9 engagement:
#Source1-9100+Abs GapRatio1chapter_complete9.6235.4+225.824×2PlayerLevelUpChest2.6104.3+101.740×3river_rush0.531.2+30.769×4single_collection0.330.0+29.794×5race_event1.323.9+22.618×6red_event0.219.9+19.799×7chuck_event0.219.9+19.7100×8bomb_event0.216.0+15.876×9season_pass_event3.417.0+13.65×10kite_festival_event0.0311.7+11.6386×
Top sources by ratio (most engagement-amplifying):

kite_festival_event (386×)
Jigsaw (158×)
Photoshoot (156×)
bomb_ballet_event (115×)
Bird events red/chuck/bomb (~100× each — interesting clustering)

Most evenly-distributed sources (casual lifelines):

team_versus_contribution: 1.31× ratio
RewardVideo.Chest: 2.37×
team_versus: 2.63×
team_collection: 2.92×
season_pass_event: 4.94×

5.9 DAU declining
Player-days dropped from 1.46M (week 02-16) to 1.34M (week 05-04), ~-8% over 12 weeks. Final week 05-11 dropped further to 1.15M but likely partial data — confirm before interpreting.

6. Known Limitations & Caveats
6.1 Event uptime not accounted for
hc_gain_free_per_player_day divides by ALL active player-days, including days the event wasn't running at all. For time-limited events this dilutes the per-day metric.
Impact:

Ratios (100+/1-9) — unaffected. Both numerator and denominator are diluted by the same uptime factor.
Absolute values — affected. Event sources look smaller than they actually are during live windows.
Composition shifts (% of HC) — partly real, partly uptime artifact. Especially dreamheist (didn't exist for first 6 weeks).
Step-change analyses for race_event / team_versus — unaffected. Both are always-on features.
dreamheist_event ramp curve — affected. Can't separate "event ran fewer days" from "event paid less per active day."

Fix options (in order of preference):

Join to a LiveOps event calendar with start/end dates per event → use uptime-conditional denominator
Infer event-live days from daily-grain data thresholds
Report both metrics in parallel: share-of-economy AND conditional-when-live

6.2 Other notes

Per-player-day metric does NOT normalize for levels-played within a day. A 100+ player completes ~20× more levels in a day; if a source pays per level, that explains 20× of any ratio without indicating a design problem.
7d rolling avg quirk (counts days played, not calendar days) — known and preserved across queries for consistency with prior team analyses.
FI/PL geo filter applied only on events side. Denominator includes FI/PL players, numerator excludes them. Same minor bias as in prior team queries.


7. Open Questions / Next Steps
In priority order:

What launched/tuned on 2026-04-20? (team_versus step DOWN) — check LiveOps calendar / release notes.
What launched/tuned on 2026-04-13? (race_event step UP) — distinct week, likely different cause.
Is dreamheist_event's engagement gate intentional? Casuals (0 / 1-9) get effectively nothing. Mid-engagement (40-99) appears to hit a cap.
Substitution hypothesis test for chapter_complete decline: did saga completes per active player drop on event weeks (03-30, 04-27)? If yes, decline is behavioral, not rewards.
Was the 04-27 ~3x dreamheist scale-up intentional? Tuning oversight, planned ramp, or beacon change?
River Rush item-claim distribution by HC bucket (query 4.3) — see how much HC comes from loop rounds (10-15) vs progression rounds (1-9). Query written but schema guesses need verification.
Event uptime calendar — get a hold of LiveOps event start/end dates to enable conditional-when-live metric.
Last-week (05-11) data completeness — confirm partial-data hypothesis before reading too much into final week.


8. River Rush — Specific Context
(Used for the per-event distribution query and item analysis.)
Mechanics

Streak-based competitive event, 5 players per round (always 5)
Ghost opponents when real players unavailable
Rounds 1-9: normal progression, played once each
Rounds 10-15: loop rounds, replayed indefinitely (cycleRounds = true, with loopbackPoint configured at round 10)
Reward = "first come, first served" — first to reach reward stone has full pool; later finishers pick from remaining

Configurable per beacon

Duration / timer
Number of rounds
Level requirements per round (levels field, ≥6 due to layout)
Reward sets per round (rewardCandidates)
Ghost difficulty mix
Bot fill on/off
Cycle rounds yes/no
Opt-in required yes/no

Analytics fields specific to River Rush
Per the team's analytics doc:

m_item — index of reward chosen
m_current_round — round number 1-15
m_current_path — typically 0; non-zero only on crossroad rounds (probably N/A for River Rush)
m_score_count — cumulative tokens (= levels won)
m_leaderboard_position — finishing position
m_leaderboard_id — unique competitor-group ID
m_event_name = 'river_rush' OR m_action_sub1 = 'river_rush' (schema not personally verified)

Most recent run window
2026-04-23 → 2026-04-30 (8 days). Used for the distribution / item-claim queries in 4.2/4.3.
Hypothesis at launch
"Streak-based competitive event with engaging narrative + scarcity element → +10% ARPDAU on highly competitive players who have spent at least once."

9. Document History

2026-05-18: Created. Captures methodology and findings from May 17 investigation.