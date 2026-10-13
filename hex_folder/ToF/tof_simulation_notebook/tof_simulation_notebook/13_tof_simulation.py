import numpy as np

rng = np.random.default_rng(42)
n_players = 1_000_000

def to_uniform(x):
    return (np.argsort(np.argsort(x)) + 0.5) / len(x)

def power_law(xmin, xmax, alpha, u):
    if np.isclose(alpha, 1):
        return xmin * (xmax / xmin) ** u
    a, b = xmin ** (1 - alpha), xmax ** (1 - alpha)
    return (a + u * (b - a)) ** (1 / (1 - alpha))

budget_cashout_corr = float(in_budget_cashout_corr)
z1, e = rng.standard_normal((2, n_players))
z2 = budget_cashout_corr * z1 + np.sqrt(1 - budget_cashout_corr ** 2) * e
u_meaningless, u_cashout = to_uniform(z1), to_uniform(z2)

meaningless_min = float(in_meaningless_min)
meaningless_max = float(in_meaningless_max)
meaningless_alpha = float(in_meaningless_alpha)
meaningless_investment = power_law(meaningless_min, meaningless_max, meaningless_alpha, u_meaningless)

cashout_min = float(in_cashout_min)
cashout_max = float(in_cashout_max)
cashout_alpha = float(in_cashout_alpha)
cashout_level = power_law(cashout_min, cashout_max, cashout_alpha, u_cashout)
realized_corr = np.corrcoef(u_meaningless, u_cashout)[0, 1]

pig_prob = input_table["Pig probability"].to_numpy()
costs = pig_cost_table["Cost"].to_numpy()

pig_draws = rng.random((n_players, len(pig_prob))) < pig_prob

balance = np.zeros(n_players)
rewards = np.zeros(n_players)
pigs = np.zeros(n_players, dtype=int)
alive = np.ones(n_players, dtype=bool)
stages_cleared = np.zeros(n_players, dtype=int)
pig_spend = np.zeros(n_players)
cards = np.zeros(n_players, dtype=int)
coins_won = np.zeros(n_players)
reward_coins = [g.loc[~g["is_pig_row"], "Coins"].to_numpy() for _, g in reward_matrix.groupby("Stage")]
reward_cards = [g.loc[~g["is_pig_row"], "Cards"].to_numpy() for _, g in reward_matrix.groupby("Stage")]

for s in range(len(pig_prob)):
    cost = costs[np.minimum(pigs, len(costs) - 1)]
    pig_free_stage = (s + 1) % 5 == 0

    # Has the player spent more than initially willing?
    spent_more_than_willing = pig_spend > meaningless_investment
    too_expensive_pig = pig_spend + cost > meaningless_investment
    
    # Has the player reached the target reward level
    target_reached = (rewards >= cashout_level)
    super_cheap_pig = cost < rewards * 0.5
    
    # Cash out logic - target reached and next pig not super cheaap, or spent more than willing
    cash_out = alive & (not pig_free_stage) & ((target_reached & ~super_cheap_pig) | spent_more_than_willing)
    
    alive &= ~cash_out
    has_pig = pig_draws[:, s] & alive
    
    # Player pays the pig, if not going to end up spending more than willing OR if the cost is less than 80% of the rewards so far
    pays = has_pig & (~too_expensive_pig | (cost < 0.8 * rewards))
    
    busted = has_pig & ~pays
    
    # Update the players' balances, pig spends and pig counts
    balance[pays] -= cost[pays]
    pig_spend[pays] += cost[pays]
    pigs[pays] += 1

    # Update the numbers for the busted players
    balance[busted] = -pig_spend[busted]
    cards[busted] = 0
    coins_won[busted] = 0
    alive &= ~busted

    # Update the rewards for players who continue
    opts = np.array(reward_options[s])
    idx = rng.integers(0, len(opts), n_players)
    stage_reward = opts[idx]
    balance[alive] += stage_reward[alive]
    rewards[alive] += stage_reward[alive]
    cards[alive] += reward_cards[s][idx][alive]
    coins_won[alive] += reward_coins[s][idx][alive]
    stages_cleared[alive] += 1

sim_results = pd.DataFrame({"coin_net_gain": balance, "coins_won": coins_won, "cards": cards, "stages_cleared": stages_cleared, "pigs_passed": pigs, "pig_spend": pig_spend, "meaningless_budget": meaningless_investment, "cashout_level": cashout_level})

pcts = np.concatenate([[1], np.arange(5, 100, 5), [99, 99.9]])
winnings_percentiles = pd.DataFrame({
    "percentile": pcts,
    "coin_net_gain": np.percentile(balance, pcts, method="lower"),
    "coins_won": np.percentile(coins_won, pcts, method="lower"),
    "coins_paid": np.percentile(pig_spend, pcts, method="lower"),
    "cards": np.percentile(cards, pcts, method="lower"),
    "stages_cleared": np.percentile(stages_cleared, pcts, method="lower"),
    "pigs_passed": np.percentile(pigs, pcts, method="lower"),
})
winnings_percentiles
