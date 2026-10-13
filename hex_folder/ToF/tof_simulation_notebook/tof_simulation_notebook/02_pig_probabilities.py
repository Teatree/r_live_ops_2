import pandas as pd
from io import StringIO

csv_data = """Stage	Pig probability	Reward coin equivalent
1	0.0%	6.00
2	25.0%	7.00
3	25.0%	8.67
4	33.0%	18.67
5	0.0%	21.75
6	33.0%	40.00
7	33.0%	35.00
8	33.0%	34.00
9	33.0%	40.00
10	0.0%	41.25
11	33.0%	50.00
12	33.0%	31.67
13	33.0%	58.33
14	33.0%	76.67
15	0.0%	88.75
16	33.0%	106.67
17	50.0%	86.67
18	33.0%	130.00
19	50.0%	166.67
20	0.0%	185.00
21	33.0%	180.00
22	50.0%	216.67
23	33.0%	226.67
24	50.0%	263.33
25	0.0%	308.75
26	33.0%	253.33
27	50.0%	385.00
28	33.0%	333.33
29	50.0%	406.67
30	0.0%	351.25
31	33.0%	473.33
32	50.0%	500.00
33	33.0%	351.67
34	50.0%	500.00
35	0.0%	453.75
"""

input_table = pd.read_csv(StringIO(csv_data), sep="\t", thousands=",")
input_table["Pig probability"] = input_table["Pig probability"].str.rstrip("%").astype(float) / 100
input_table = input_table.drop(columns=["Reward coin equivalent"])
input_table
