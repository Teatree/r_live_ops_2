-- Dataframe SQL (DuckDB) -> output: album_bands_vs_actual
WITH actuals_ext AS (
    SELECT player_id, level_bucket, payer_type, day, metric, cum_value
    FROM album_actuals_player
    UNION ALL
    SELECT player_id, level_bucket, payer_type, day, 'album_pct' AS metric,
           cum_value / 72.0 * 100 AS cum_value
    FROM album_actuals_player
    WHERE metric = 'unique_cards'
),
actual AS (
    SELECT level_bucket, payer_type, day, metric,
           AVG(cum_value) AS actual_mean,
           COUNT(DISTINCT player_id) AS actual_players
    FROM actuals_ext
    GROUP BY 1, 2, 3, 4
)
SELECT b.day, b.level_bucket, b.payer_type, b.metric, b.mean, b.p10, b.p90, b.segment,
       a.actual_mean, a.actual_players
FROM album_bands b
LEFT JOIN actual a
  ON CAST(b.level_bucket AS VARCHAR) = a.level_bucket
 AND b.payer_type = a.payer_type
 AND b.day = a.day
 AND b.metric = a.metric
ORDER BY b.metric, b.level_bucket, b.payer_type, b.day
