import numpy as np

reward_cols = ["Coins", "SPT", "SPT x2", "Red", "Chuck", "Bomb", "Slingshot", "Shuffle", "Comet",
               "Unlimited Lives", "Unlimited Red", "Unlimited Chuck", "Unlimited Bomb", "COOP Token", "Avatar",
               "1-star Dly", "2-star Dly", "3-star Dly", "4-star Dly", "5-star Dly"]

stage_rows = [
    ["Unlimited Lives:5:2.5", "Unlimited Lives:10:5", "SPT:5:5.5", "SPT:10:11"],
    ["SPT:5:5.5", "SPT:10:11", "Unlimited Lives:10:5", None],
    ["Unlimited Lives:10:5", "Coins:10:10", "SPT:10:11", None],
    ["Unlimited Lives:10:5", "Slingshot:1:40", "SPT:10:11", None],
    ["1-star Dly:1:25", "SPT:20:22", "Unlimited Lives:20:10", "Coins:30:30"],
    ["SPT:20:22", "Slingshot:1:40", "Red:1:40", None],
    ["1-star Dly:1:25", "Shuffle:1:40", "Red:1:40", None],
    ["Red:1:40", "Coins:40:40", "SPT:20:22", None],
    ["1-star Dly:1:25", "2-star Dly:1:45", "Chuck:1:50", None],
    ["Chuck:1:50", "2-star Dly:1:45", "SPT:40:44", "Unlimited Lives:30:15"],
    ["Unlimited Red:10:60", "Red:1:40", "Chuck:1:50", None],
    ["Slingshot:1:40", "Shuffle:1:40", "Unlimited Lives:30:15", None],
    ["Coins:60:60", "Comet:1:70", "2-star Dly:1:45", None],
    ["SPT:60:66", "Unlimited Red:10:60", "Bomb:1:70", None],
    ["Coins:120:120", "Shuffle:2:80", "2-star Dly:1:45", "3-star Dly:1:110"],
    ["Unlimited Red:20:120", "Unlimited Chuck:10:100", "Red:2:80", None],
    ["SPT x2:10:100", "Chuck:2:100", "Slingshot:2:80", None],
    ["Bomb:2:140", "3-star Dly:1:110", "Comet:2:140", None],
    ["SPT x2:10:100", "Unlimited Red:30:180", "Unlimited Chuck:20:200", None],
    ["Coins:250:250", "3-star Dly:1:110", "4-star Dly:1:220", "Slingshot:4:160"],
    ["Comet:3:210", "Shuffle:3:120", "Unlimited Bomb:10:210", None],
    ["SPT x2:20:200", "Red:5:200", "Chuck:5:250", None],
    ["Coins:250:250", "4-star Dly:1:220", "Bomb:3:210", None],
    ["Unlimited Bomb:10:210", "Unlimited Chuck:30:300", "Comet:3:210", None],
    ["Coins:400:400", "4-star Dly:1:220", "5-star Dly:1:335", "Bomb:4:280"],
    ["Shuffle:6:240", "Red:6:240", "Slingshot:6:240", None],
    ["Chuck:8:400", "Unlimited Bomb:20:420", "5-star Dly:1:335", None],
    ["Coins:400:400", "Slingshot:8:320", "Comet:6:420", None],
    ["Red:8:320", "Chuck:8:400", "Bomb:5:350", None],
    ["Coins:500:500", "4-star Dly:1:220", "5-star Dly:1:335", "Bomb:6:420"],
    ["Unlimited Bomb:20:420", "Red:8:320", "Comet:8:560", None],
    ["Coins:500:500", "Shuffle:8:320", "Chuck:8:400", None],
    ["Red:8:320", "Bomb:8:560", "5-star Dly:1:335", None],
    ["Slingshot:8:320", "Shuffle:8:320", "Comet:8:560", None],
    ["Coins:500:500", "5-star Dly:1:335", "Comet:8:560", "Bomb:8:560"],
]

records = []
for s, opts in enumerate(stage_rows, start=1):
    for o, spec in enumerate(opts, start=1):
        row = {"Stage": s, "Option": o, **{c: 0 for c in reward_cols}, "coin_val": 0.0}
        if spec:
            item, count, val = spec.split(":")
            row[item] = int(count)
            row["coin_val"] = float(val)
        records.append(row)

reward_matrix = pd.DataFrame(records)
reward_matrix["is_pig_row"] = reward_matrix["coin_val"] == 0
cards_per_pack = {f"{n}-star Dly": n + 1 for n in range(1, 6)}
reward_matrix["Cards"] = sum(reward_matrix[c] * k for c, k in cards_per_pack.items())

reward_options = [g.loc[~g["is_pig_row"], "coin_val"].tolist() for _, g in reward_matrix.groupby("Stage")]
stage_reward_options = pd.DataFrame({
    "Stage": range(1, len(reward_options) + 1),
    "Options": [", ".join(f"{v:g}" for v in o) for o in reward_options],
    "Mean reward": [np.mean(o) for o in reward_options],
})
reward_matrix
