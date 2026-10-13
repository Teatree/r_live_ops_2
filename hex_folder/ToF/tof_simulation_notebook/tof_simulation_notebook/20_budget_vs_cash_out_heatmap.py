import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm

xb = np.logspace(np.log10(meaningless_min), np.log10(meaningless_max), 40)
yb = np.logspace(np.log10(cashout_min), np.log10(cashout_max), 40)

fig, ax = plt.subplots(figsize=(9, 7))
h = ax.hist2d(meaningless_investment, cashout_level, bins=[xb, yb], norm=LogNorm(), cmap="viridis")
ax.set_xscale("log")
ax.set_yscale("log")
ax.set_xlabel("Ready to lose budget (coins, log)")
ax.set_ylabel("Cash-out target (coins, log)")
ax.set_title(f"Ready to lose vs cash-out target (rank corr = {realized_corr:.2f})")
fig.colorbar(h[3], ax=ax, label="Players (log scale)")
plt.show()
