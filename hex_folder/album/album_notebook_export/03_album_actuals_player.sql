-- Warehouse SQL (Athena cloud) -> output: album_actuals_player
WITH ev AS (
    SELECT
        event_id,
        CAST(
            FROM_UNIXTIME(MIN(CAST(event_start_time AS bigint)) / 1000) AS date
        ) AS start_date
    FROM abgbproduction_174525b3_gdpr.client_events_view_event_progress
    WHERE
        event_id IN (
            SELECT DISTINCT event_id FROM tmp_radekjanhuba.album_metrics_daily
        )
        AND event_date >= CURRENT_DATE - INTERVAL '60' DAY
    GROUP BY 1
),
raw AS (
    SELECT
        m.event_id,
        m.player_id,
        DATE_DIFF('day', ev.start_date, CAST(m.event_date AS date)) + 1 AS day,
        CASE
            WHEN
                m.metric = 'envelopes_opened' AND m.breakdown = 'total'
                THEN 'packs_opened'
            WHEN
                m.metric = 'snaps_gained' AND m.breakdown = 'total'
                THEN 'cards_drawn'
            WHEN
                m.metric = 'snaps_gained' AND m.breakdown = 'unique'
                THEN 'unique_cards'
            WHEN m.metric = 'sets_completed' THEN 'sets_completed'
        END AS metric,
        SUM(m.value) AS value
    FROM (
        SELECT event_id, player_id, event_date, metric, breakdown,
               MAX(CAST(value AS double)) AS value
        FROM tmp_radekjanhuba.album_metrics_daily
        WHERE
            (metric = 'envelopes_opened' AND breakdown = 'total')
            OR (metric = 'snaps_gained' AND breakdown IN ('total', 'unique'))
            OR metric = 'sets_completed'
        GROUP BY 1, 2, 3, 4, 5
    ) AS m
    INNER JOIN ev ON m.event_id = ev.event_id
    GROUP BY 1, 2, 3, 4
),
lvl AS (
    SELECT
        e.event_id,
        e.player_id,
        MIN_BY(e.player_profile_level, e.o_ts) AS profile_level
    FROM abgbproduction_174525b3_gdpr.client_events_view_event_progress AS e
    INNER JOIN ev ON e.event_id = ev.event_id
    WHERE
        e.event_date >= CURRENT_DATE - INTERVAL '60' DAY
        AND e.event_id IN (
            SELECT DISTINCT event_id FROM tmp_radekjanhuba.album_metrics_daily
        )
        AND e.event_date >= ev.start_date - INTERVAL '1' DAY
    GROUP BY 1, 2
),
pay AS (
    SELECT
        ev.event_id,
        p.player_id,
        MAX_BY(
            p.cumulative_money_spent,
            CASE
                WHEN
                    p.event_date < ev.start_date
                    THEN DATE_DIFF('day', p.event_date, ev.start_date) * -1
                ELSE -1000 - DATE_DIFF('day', ev.start_date, p.event_date)
            END
        ) AS cum_spend
    FROM abgbproduction_174525b3_gdpr.player_daily AS p
    CROSS JOIN ev
    WHERE
        p.event_date >= CURRENT_DATE - INTERVAL '90' DAY
        AND p.event_date BETWEEN ev.start_date
        - INTERVAL '30' DAY AND ev.start_date
        + INTERVAL '28' DAY
        AND p.player_id IN (SELECT DISTINCT player_id FROM raw)
    GROUP BY 1, 2
),
players AS (
    SELECT DISTINCT
        r.event_id,
        r.player_id,
        CASE
            WHEN l.profile_level < 10 THEN '0-9' WHEN
                l.profile_level < 20
                THEN '10-19'
            WHEN l.profile_level < 40 THEN '20-39' WHEN
                l.profile_level < 100
                THEN '40-99'
            ELSE '100+'
        END AS level_bucket,
        CASE
            WHEN COALESCE(p.cum_spend, 0) > 0 THEN 'PAYER' ELSE 'NONPAYER'
        END AS payer_type
    FROM raw AS r
    LEFT JOIN lvl AS l ON r.event_id = l.event_id AND r.player_id = l.player_id
    LEFT JOIN pay AS p ON r.event_id = p.event_id AND r.player_id = p.player_id
),
grid AS (
    SELECT
        pl.*,
        d.day,
        mt.metric
    FROM players AS pl
    CROSS JOIN (SELECT LEAST(MAX(day), 28) AS max_day FROM raw) AS x
    CROSS JOIN UNNEST(SEQUENCE(1, x.max_day)) AS d (day)
    CROSS JOIN (VALUES 'packs_opened', 'cards_drawn', 'unique_cards', 'sets_completed') AS mt(metric)
),
daily AS (
    SELECT
        g.event_id,
        g.player_id,
        g.level_bucket,
        g.payer_type,
        g.day,
        g.metric,
        COALESCE(SUM(r.value), 0) AS daily_value
    FROM
        (SELECT DISTINCT
            event_id,
            player_id,
            level_bucket,
            payer_type,
            day,
            metric
        FROM grid) AS g
    LEFT JOIN
        raw AS r
        ON
            g.event_id = r.event_id
            AND g.player_id = r.player_id
            AND g.day = r.day
            AND g.metric = r.metric
    GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT
    event_id,
    player_id,
    level_bucket,
    payer_type,
    day,
    metric,
    daily_value,
    SUM(daily_value)
        OVER (PARTITION BY event_id, player_id, metric ORDER BY day)
        AS cum_value
FROM daily
ORDER BY metric, player_id, day
