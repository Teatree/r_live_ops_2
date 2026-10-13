def fmt_option(spec):
    if spec is None:
        return "PIG"
    item, count, val = spec.split(":")
    return f"{count}× {item} ({float(val):g})"

stage_rewards_view = pd.DataFrame(
    [[s] + [fmt_option(o) for o in opts] + [np.mean(reward_options[s - 1])]
     for s, opts in enumerate(stage_rows, start=1)],
    columns=["Stage", "Option 1", "Option 2", "Option 3", "Option 4", "Mean coin value"],
)
stage_rewards_view
