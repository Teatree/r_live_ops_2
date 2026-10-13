-- Dataframe SQL (DuckDB) -> output: day9_check
SELECT level_bucket, payer_type, metric, actual_players, ROUND(actual_mean, 1) AS actual_mean, mean AS pred_mean, p90 AS pred_p90
FROM album_bands_vs_actual
WHERE day = 9 AND actual_mean IS NOT NULL
ORDER BY metric, level_bucket, payer_type
