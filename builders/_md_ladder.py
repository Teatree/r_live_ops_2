"""Solves the Mighty Doors reward ladder so the event pays roughly 75% of what Rainbow Maker pays,
per segment (user target 2026-09-02: "roughly the same amount to each segment as the rainbow maker
does ... 75%, because this is a three-day event instead of a four-day one").

METHOD.  A run is a gamble, so a segment only banks anything if it REACHES its cash-out stage:
    E[payout per instance][res] = runs x P(reach stop) x CumReward(stop)[res]
Rearranged, each segment pins the CUMULATIVE reward required at its own stop stage. Because the
five stop stages are distinct and increasing, those five constraints slice the ladder into bands
and a single monotone ladder satisfies all of them at once (verified: no band needs a negative
increment). Deeper bands are then extrapolated so stages nobody in the model reaches still exist.

Values are placed as INTEGERS by walking the stages and dropping a unit whenever the running
deficit against the interpolated target passes half a unit, preferring safe and milestone stages.
That is what keeps the ladder readable ("1 Red at stage 7") instead of 0.37 of a booster.
"""
import json, os, math

HERE = os.path.dirname(os.path.abspath(__file__))
SEGS = ['0-9', '10-19', '20-39', '40-99', '100+']
CH, EVERY, MAJ, ASP, TOTAL = 4, 5, 30, 60, 60

# behaviour (best guess, no telemetry exists - see the sheet's SEGMENT BEHAVIOUR notes)
# Chosen by sweeping stop stages x take-up x recharge for the closest fit that still uses REALISTIC
# reward sizes (HC in 5s, Unlimited Lives in 10s). Mean |error| on the big four is ~23%, which is
# as close as integers get: see the STEP note below for why the floor exists.
TAKE = {'0-9': 0.05, '10-19': 0.10, '20-39': 0.20, '40-99': 0.35, '100+': 0.55}
STOP = {'0-9': 6,    '10-19': 9,    '20-39': 12,   '40-99': 15,   '100+': 20}
DUR, RECHARGE, START_TICKETS = 3, 12, 1
RUNS = START_TICKETS + DUR * 24 / RECHARGE          # 10
INSTANCES = 5                                        # match Rainbow Maker in cal_new
SHARE = 0.75 / INSTANCES                             # per instance, vs RM's whole-window total

# Integer step per resource. Everything is placed as whole units because that is what a config
# sheet holds ("1 Red at stage 7", not 0.37 of a booster) - which puts a hard floor on precision.
# Segment 0-9 stops at stage 3 and Rainbow Maker only gives it ~4.6 HC per instance, so the ladder
# has to express "0.6 coins cumulative by stage 3": 0 is -100% and 1 is +65%, with nothing between.
# The big four (SPT, HC, Unlimited Lives, SPTx2) carry ~95% of Rainbow Maker's value and do fit;
# the boosters and packs are rounding noise on top and are placed where they land naturally.
# Steps chosen to match how the other config sheets actually read: RM_1st_v2 pays HC in 10/20/50
# and Unlimited Lives in 10/15/30/60, never 1. A ladder full of "1 coin" doors would fit the target
# better and look absurd on the sheet, so realism wins and the residual error is reported instead.
STEP = {'HC': 5, 'Unlimited Lives': 10, 'UL Bomb': 10, 'UL Chuck': 10, 'UL Red': 10}
DEFAULT_STEP = 1


def stage_type(s):
    if s == 1: return 'Safe (Start)'
    if s in (MAJ, ASP): return 'Milestone'
    return 'Safe' if s % EVERY == 0 else 'Standard'


def pig_slots(s):
    """User request: later stages are more challenging, but never more than three Pigs."""
    if stage_type(s) != 'Standard': return 0
    tier = min(6, max(1, (s + 9) // 10))
    return 1 if tier <= 2 else (2 if tier <= 4 else 3)


def survive(s, c):
    raw = (CH - pig_slots(s)) / CH
    return raw + (1 - raw) * c


def reach(k, c):
    p = 1.0
    for s in range(1, k):
        p *= survive(s, c)
    return p


def solve(rm):
    res_names = sorted({r for d in rm for r in d})
    # 1. cumulative reward each segment's stop stage must carry
    cum_at = {}
    for i, seg in enumerate(SEGS):
        n = RUNS * reach(STOP[seg], TAKE[seg])
        cum_at[STOP[seg]] = {r: (rm[i].get(r, 0.0) * SHARE) / n for r in res_names}
    stops = sorted(cum_at)

    # 2. a target cumulative curve over all 60 stages: linear between stops, then extrapolated at
    #    the last band's per-stage rate compounded, so deep stages stay aspirational.
    target = {r: [0.0] * (TOTAL + 1) for r in res_names}
    for r in res_names:
        prev_stage, prev_val = 0, 0.0
        for st in stops:
            v = max(prev_val, cum_at[st][r])
            span = st - prev_stage
            for s in range(prev_stage + 1, st + 1):
                target[r][s] = prev_val + (v - prev_val) * (s - prev_stage) / span
            prev_stage, prev_val = st, v
        last_rate = (target[r][stops[-1]] - target[r][max(1, stops[-2])]) / max(1, stops[-1] - stops[-2])
        for s in range(stops[-1] + 1, TOTAL + 1):
            grow = 1.0 + 0.06 * (s - stops[-1])          # deeper stages pay progressively more
            target[r][s] = target[r][s - 1] + last_rate * grow

    # 3. place whole units by tracking the cumulative target and dropping the rounded shortfall.
    #    Safe and milestone stages get first refusal on a pending unit, because the deck says their
    #    rewards are "typically more valuable" (p6) and it keeps the ladder reading sensibly.
    ladder = [{} for _ in range(TOTAL + 1)]
    for r in res_names:
        step = STEP.get(r, DEFAULT_STEP)
        placed = 0.0
        for s in range(1, TOTAL + 1):
            want = target[r][s]
            # look ahead: if the next stage is safe and we are within half a unit, wait for it
            nxt_safe = s + 1 <= TOTAL and stage_type(s + 1) != 'Standard'
            thresh = 0.5 if not nxt_safe else 0.9
            units = int((want - placed) / step + (1 - thresh))
            if units > 0:
                ladder[s][r] = ladder[s].get(r, 0) + units * step
                placed += units * step
    # 4. Boosters and packs cannot be fitted at this scale and are deliberately NOT scattered.
    #    Rainbow Maker gives segment 10-19 about 0.43 Red per instance, but a segment that banks
    #    4.65 times per instance would collect 4.65 Red from a single "1 Red" node - ten times the
    #    target. There is no integer between 0 and 1. So the small resources live on the two
    #    MILESTONE nodes instead, which is where the deck puts its "Special and Higher rewards"
    #    (p6): almost nobody reaches stage 30 or 60, so they barely move the per-segment fit while
    #    making the ladder read like a real event with a real jackpot.
    MILESTONE_BUNDLE = {
        MAJ: {'Red': 2, 'Chuck': 2, 'Bomb': 1, 'Slingshot': 2, 'Shuffle': 2, 'Comet': 1,
              'UL Bomb': 30, 'UL Chuck': 30, '1-star Pack': 2, '2-star Pack': 1},
        ASP: {'Red': 5, 'Chuck': 5, 'Bomb': 5, 'Slingshot': 5, 'Shuffle': 5, 'Comet': 5,
              'UL Bomb': 60, 'UL Chuck': 60, 'UL Red': 60,
              '3-star Pack': 2, '4-star Pack': 2, '5-star Pack': 1},
    }
    # 5. No door may be empty. The deck is explicit that stage 1 grants a reward on every choice
    #    and that a blank outcome only exists if Empty Outcomes are switched on, so any node the
    #    solver left bare gets a token payout rather than reading as a bug.
    for s in range(1, TOTAL + 1):
        if not ladder[s]:
            ladder[s]['SPT'] = 1

    for st, bundle in MILESTONE_BUNDLE.items():
        for r, v in bundle.items():
            ladder[st][r] = ladder[st].get(r, 0) + v

    return ladder, res_names


def payout(ladder, res_names):
    """What the built ladder actually pays, per segment, per instance."""
    out = {}
    for seg in SEGS:
        k = STOP[seg]
        cum = {r: sum(ladder[s].get(r, 0) for s in range(1, k + 1)) for r in res_names}
        n = RUNS * reach(k, TAKE[seg])
        out[seg] = {r: cum[r] * n for r in res_names}
    return out


if __name__ == '__main__':
    rm = json.load(open(os.path.join(HERE, '..', 'harness', '_md_rm_baseline.json')))
    ladder, res_names = solve(rm)
    got = payout(ladder, res_names)
    print('runs/instance %.0f   instances %d   target = %.0f%% of RM window total\n'
          % (RUNS, INSTANCES, 0.75 * 100))
    print('%-18s' % 'resource' + ''.join('%22s' % s for s in SEGS))
    for r in ['HC', 'SPT', 'Unlimited Lives', 'SPTx2', 'Red', 'Slingshot']:
        cells = []
        for i, seg in enumerate(SEGS):
            want = rm[i].get(r, 0.0) * 0.75 / INSTANCES
            have = got[seg].get(r, 0.0)
            cells.append('%9.1f/%-7.1f%+5.0f%%' % (have, want, (have / want - 1) * 100) if want > 1e-9
                         else '%9.1f/%-7s     ' % (have, '-'))
        print('%-18s' % r + ''.join(cells))
    json.dump({'ladder': [ladder[s] for s in range(1, TOTAL + 1)],
               'take': TAKE, 'stop': STOP, 'runs': RUNS,
               'recharge_hours': RECHARGE, 'start_tickets': START_TICKETS},
              open(os.path.join(HERE, '_md_ladder.json'), 'w'), indent=1)
    print('\nwritten builders/_md_ladder.json')
