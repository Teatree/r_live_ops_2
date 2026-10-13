pig_costs = [75, 150, 300, 500, 750, 1000, 1250, 1500, 1750] + [2000] * 26

pig_cost_table = pd.DataFrame({"Round": range(1, 36), "Cost": pig_costs})
pig_cost_table
