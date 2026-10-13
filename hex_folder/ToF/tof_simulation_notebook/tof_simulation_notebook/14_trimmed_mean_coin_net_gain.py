def trimmed_mean(x, lo_pct=1, hi_pct=99):
    lo, hi = np.percentile(x, [lo_pct, hi_pct])
    return x[(x >= lo) & (x <= hi)].mean()

trimmed_mean_winnings = trimmed_mean(balance)
trimmed_mean_cards = trimmed_mean(cards)
pd.DataFrame({
    "metric": ["Mean (all players)", "Trimmed mean (P1–P99)", "Median"],
    "coin_net_gain": [balance.mean(), trimmed_mean_winnings, np.median(balance)],
    "coins_won": [coins_won.mean(), trimmed_mean(coins_won), np.median(coins_won)],
    "coins_paid": [pig_spend.mean(), trimmed_mean(pig_spend), np.median(pig_spend)],
    "cards": [cards.mean(), trimmed_mean_cards, np.median(cards)],
})
