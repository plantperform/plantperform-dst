# Udbytterespons: N below the norm

A simulation can fertilize at 100 % of the N-norm and at up to two lower levels
(N-norm%). This page describes when a lower level applies and what it costs in
yield. The curves and their sources are documented in
`backend/src/app/services/economics/udbytterespons.py`.

## The rule

- The N-norm% is the total available N, forfrugtsværdi included:
  `mncs = max(0, n_norm × pct − forfrugtsværdi)`
  (`compute_n_inputs` in `services/scenario/candidate_evaluator.py`).
- Only crops with a curve for the simulation's driftsform are cut.
  `har_udbytterespons(afgrødekode, driftsform)` decides. Every other crop is
  fertilized at 100 % and keeps its full udbyttenorm.
- The yield follows `udbyttefaktor = 1 − (a·r + b·r²)` with
  `r = 1 − tilgængeligt N / N-norm`. The curves stop at 50 % of the norm
  (`MIN_ANDEL`).

## Konventionel and økologisk

| | Konventionel | Økologisk |
| --- | --- | --- |
| Source | Kenneth Hansen's ResponsTilKvotereduktion.xlsx | ICOEL's OYUP WP2 organic trials, NFTS rapeseed trials 2021–22 |
| Crops | 1, 3, 10, 11, 15, 22, 101, 151, 160, 216, 260, 263; 70/72 follow 1/3 | 1, 2, 3, 11, 14, 22 from the trials; 10 ← 11, 15 ← 14, 70/71/72 ← 1/2/3 borrowed; græs 260/263 shares the konventionel curve per kg N |
| a, b relative to | the konventionel N-norm | the organic N-norm in the master table |

An organic curve is used only when the crop has a real organic norm row (rows
with driftsform Økologisk in `afgroede_norm_lookup`). On the konventionel
fallback the N would be cut without the yield loss that goes with it. The
guard sits in both `compute_n_inputs` and `calculate_db` (`er_reel_oeko_norm`).

The organic norms and udbyttenormer live in the master table
(`Afgroedetabel2027_master.csv`, columns `*_okologisk`), which is not in git.
If they change, the organic a and b must be recalculated from the WP2 data
basis (`build_norm_basis.py` in the udbyttekurver scripts, outside the repo).

## Gødning

- Økologisk never uses handelsgødning. Its N comes from organic gødning only,
  up to the simulation's `org_mineral_n`. Without organic gødning an økologisk
  field gets no N, so the form does not offer "Ingen organisk gødning" for
  økologisk.
- Husdyrgødning is spread per tonne: "Gylleudbringning, slæbeslanger" times
  the tonnes applied. Tonnes = tildelt udnyttet N / the gødning's udnyttet
  N-indhold per tonne (`n_indhold_kg_per_ton`, default 6). This applies to
  konventionel gylle too.
