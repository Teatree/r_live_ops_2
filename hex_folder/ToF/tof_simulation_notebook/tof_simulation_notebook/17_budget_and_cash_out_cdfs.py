cdf_pcts = np.arange(0, 100.5, 0.5)
budget_cdf = pd.DataFrame({
    "percentile": cdf_pcts / 100,
    "meaningless_budget": np.percentile(meaningless_investment, cdf_pcts),
    "cashout_level": np.percentile(cashout_level, cdf_pcts),
})
budget_cdf
