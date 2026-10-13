import io, re
import pandas as pd

def _read_text(f):
    if f is None:
        return None
    if isinstance(f, (bytes, bytearray)):
        return f.decode("utf-8-sig")
    if hasattr(f, "name") and isinstance(getattr(f, "name"), str):
        with open(f.name, "rb") as fh:
            return fh.read().decode("utf-8-sig")
    if hasattr(f, "read"):
        if hasattr(f, "seek"):
            f.seek(0)
        d = f.read()
        return d.decode("utf-8-sig") if isinstance(d, bytes) else d
    with open(str(f), "rb") as fh:
        return fh.read().decode("utf-8-sig")

_METRIC_MAP = {"Packs Opened": "packs_opened", "Cards Drawn": "cards_drawn", "Unique Cards": "unique_cards",
               "Sets Completed": "sets_completed", "Album %": "album_pct", "Star Balance": "star_balance"}
_STAT_MAP = {"MEAN": "mean", "P10": "p10", "P90": "p90"}
_SEG_RE = re.compile(r"^(0-9|10-19|20-39|40-99|100\+)\s+(NONPAYER|PAYER)$")

def parse_bands(text):
    records, seg, metric_by_col, stat_by_col = [], None, {}, {}
    for line in text.splitlines():
        cells = [c.strip() for c in line.split("\t")]
        first = cells[0] if cells else ""
        m = _SEG_RE.match(first)
        if m and not any(cells[1:]):
            seg, metric_by_col, stat_by_col = (m.group(1), m.group(2)), {}, {}
            continue
        if seg is None:
            continue
        if first == "" and any(c in _METRIC_MAP for c in cells):
            cur = None
            for i, c in enumerate(cells):
                if c in _METRIC_MAP:
                    cur = _METRIC_MAP[c]
                if cur and i > 0:
                    metric_by_col[i] = cur
            continue
        if first.lower() == "day":
            stat_by_col = {i: c.upper() for i, c in enumerate(cells) if i > 0}
            continue
        if first.isdigit() and metric_by_col and stat_by_col:
            day = int(first)
            for i, v in enumerate(cells[1:], start=1):
                stat = _STAT_MAP.get(stat_by_col.get(i, ""))
                if stat and v != "" and i in metric_by_col:
                    records.append((day, seg[0], seg[1], metric_by_col[i], stat, float(v.replace(",", "."))))
    return pd.DataFrame(records, columns=["day", "level_bucket", "payer_type", "metric", "stat", "value"])

_text = _read_text(bands_file)
if _text is None:
    album_bands = pd.DataFrame(columns=["day", "level_bucket", "payer_type", "metric", "mean", "p10", "p90"])
else:
    _long = parse_bands(_text)
    _long = _long[_long["day"] <= 28]
    album_bands = (_long.pivot_table(index=["day", "level_bucket", "payer_type", "metric"], columns="stat",
                                     values="value", aggfunc="first")
                   .reset_index().rename_axis(columns=None))
    album_bands = album_bands[["day", "level_bucket", "payer_type", "metric", "mean", "p10", "p90"]]
    album_bands["level_bucket"] = pd.Categorical(album_bands["level_bucket"],
                                                 ["0-9", "10-19", "20-39", "40-99", "100+"], ordered=True)
    album_bands["segment"] = album_bands["level_bucket"].astype(str) + " " + album_bands["payer_type"]
    album_bands = album_bands.sort_values(["metric", "level_bucket", "payer_type", "day"]).reset_index(drop=True)
album_bands
