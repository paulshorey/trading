**Next-agent handoff: early confirmation of temporary price pivots**

Prepared November 3, 2026. Read [AGENTS.md](../../AGENTS.md), the current
[project handoff](handoff.md), and the [reviewed research](../research/pivots/2026-11-03-reviewed-findings.md)
before starting. The PR #66 follow-up adds a [pivot and structure contract](pivot-structure-design.md)
for confirmed higher/lower highs/lows, provisional relations, and fixed-scale storage.
Read that contract for the current implementation sequence. This task implemented no
detector, model, labeling pipeline, or database change. No GC/SI detection accuracy or
latency has been measured.

The user's goal is to recognize a temporary high or low as soon as possible after it
happens, using price and volume. This will be one indicator among others; it does not
need to constitute a profitable strategy. Computation speed is not the selection
constraint; outputs will be calculated every second. Two or three algorithms are
welcome if they add distinct information. Python fits the existing engine, but the
research was not restricted by language.

| Read                                                                                    | Purpose                                                                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [Reviewed findings](../research/pivots/2026-11-03-reviewed-findings.md)                 | Primary engineering assessment: method comparison, sources, label semantics, codebase fit, and proposed benchmark        |
| [Pivot and structure contract](pivot-structure-design.md)                               | Follow-up definitions, six fixed scales, provisional HL/LH, breaches, and storage-first sequence                         |
| [Early-confirmation update](../research/pivots/2026-11-05-early-confirmation-update.md) | November 5 follow-up: random-walk baselines, stopping rule, foundation-model evidence, proposed PRs F0 and G             |
| [Order-flow predictors](../research/pivots/2026-11-05-order-flow-predictors.md)         | November 5: inventory of flow, absorption, location, and cross-market metrics; data options and costs; first event study |
| [Parallel report](../research/pivots/2026-11-03-parallel-report.md)                     | Supporting deep-research output, with references; distinguish provider recommendations from established results          |
| [Research brief](../research/pivots/2026-11-03-research-question.md)                    | Exact question and constraints sent to the research provider                                                             |
| [Provenance](../research/pivots/2026-11-03-provenance.json)                             | Research date, task IDs, processor, and source URLs; no credentials or downloaded excerpts                               |
| [Source-access notes](../research/pivots/2026-11-03-source-access.md)                   | Full-text limitations and failed fetches                                                                                 |

**Research conclusion and proposed architecture.**

Start with multiscale directional change **plus deterministic market structure**:
classify each confirmed low/high against the preceding confirmed same-kind pivot.
Expose provisional higher lows/lower highs with reversal progress. Materialize the
fixed grid after implementation correctness checks, then benchmark local-direction
challengers and calibrated classifiers. No method has demonstrated superior GC/SI
performance here.

1. **Directional change / drawup-drawdown / hysteresis:** retain a running high or low;
   confirm after a specified opposite excursion. Compare fixed-bps thresholds with
   volatility-normalized thresholds at a small number of scales. The initial stored
   grid is 0.5/1/2 ATR for each of the fast and slow streams, with the 2-spread floor
   recorded in the related plan. Freeze the trailing
   scale for the candidate; refresh only under a declared strict-new-extreme rule so
   falling volatility alone cannot confirm a motionless price. Thresholds such as
   0.25/0.5/1.0 ATR in the original research are alternative experiments, not the
   initial stored grid. Include a
   normalized spread/noise floor. Keep candidate endpoints provisional and emitted
   events immutable.
2. **Local-direction evidence:** compare a causal local-linear trend or rolling-slope
   method with one directional CUSUM/GLR/FOCuS challenger. Require evidence of opposite
   pre/post directions. Deceleration or a variance change alone is not a pivot.
   BOCPD is a later probabilistic alternative. Calibrate the full alarm policy on
   training sessions; textbook guarantees do not automatically transfer to financial
   observations. These methods share price information and are not independent votes.
3. **Optional conditional probability:** compare logistic regression with one GBDT,
   such as LightGBM, on the same causal candidates. Predict a defined finite-horizon
   outcome before it resolves. Calibrate using later, disjoint training data. Test
   price-only inputs before adding relative volume, valid aggressor delta, intensity,
   exhaustion proxies, and valid trade-sampled L1 observations.

Fixed-left/right extrema are a transparent delay benchmark. SciPy peaks, prominence,
batch segmentation, and full-history ZigZag are useful reference tools, but their
historical marks cannot be backdated into live features. Prefix-only computation or
fixed-lag smoothing can be causal when the output's actual availability is retained.
TEASER and larger sequence models are later challengers; inspected research does not
establish an advantage for this dataset and task.

**The next task follows the concrete pivot/structure contract.**

Use the [contract](pivot-structure-design.md) and the related
[stage/minute/pivot plan](plan-1h-and-pivots.md): stage/version
work, minute/hourly inputs, then the deterministic pivot/structure stage and its fixed
grid, followed by benchmarking and outcome labels. Finalize implementation details
within that workstream. This documentation follow-up performs no schema/data changes
or stage refactor and does not implement the separate plan.

Resolve these distinctions explicitly:

- A one-step local extreme, a meaningful price reversal, a local trend reversal, and
  future survival of the extreme are different outputs.
- Completion of a required reversal remains a historical fact even if the level
  breaks later. Survival through a deadline is a separate label. A pivot zone allowing
  small overshoots differs from an exact extreme.
- Retain observed extreme time/ordinal, estimated turning time when applicable, and
  confirmation/availability time. Never move a later confirmation into an earlier
  feature row. A detector may infer an older turn only as of its emission time.
- Future outcomes are legitimate supervised labels. Future-centered inputs,
  hindsight-only candidate selection, fitted preprocessing using test data, and
  overlapping training/test labels create leakage.
- Separate reversal, invalidation, fully observed timeout, and unknown follow-up due
  to missing data. A barrier already crossed before scoring is an observation, not
  an unresolved prediction target.

The detector replays the engine's released trades in order and publishes state per
second row (fast scales) and per minute row (slow scales), with rolling ATR providing
context ([plan 3.1](plan-1h-and-pivots.md#31-input-stream)). Thresholds determine reversal magnitude; neither a threshold nor a bar size
guarantees swing duration. Conventional indicators over rolling candles use separate phase state
and same-phase history at ordinal differences of 60; adjacent `1m@1s` candles share
59/60 observations. Do not treat their outputs as independent confirmation votes.

**Code and data constraints to preserve.**

Use `slot_ordinal` for window membership, phases, open-row ages, and horizons; closures
have no rows. Retain wall time separately where useful. Compute entirely within one
contract and never interpret a delivery-month switch as a reversal. Missing coverage
is unknown data. Covered no-trade seconds advance the grid but do not provide fresh
trade/quote prices. Preserve validity, unknown-aggressor coverage, and observation age.

TBBO supplies trades and the immediately preceding L1 BBO at those trades. Trade delta
and sampled queue imbalance are not complete order-flow imbalance. Cancellations,
continuous quote changes, replenishment, and deeper book state cannot be reconstructed.
Volume-based absorption/exhaustion is a conditioning hypothesis, not proof of reversal.

Start with close-based observations for an unambiguous baseline. `BaseBars.high_at`
and `low_at` can localize observed extremes, but not every intrasecond crossing. If
barrier order matters, replay DBN trades under the same release and availability rules
as the engine. Finer extreme timestamps do not make features available before their
second closes and the configured delay elapses.

State and calculations belong in shared `strategy-core`; strategy/model inputs must
declare normalized `Unit` values and pass price/size scale-invariance tests. Reference
prices remain data/event context. Publish direction, scale, candidate/confirmed status,
age, reversal magnitude, directional evidence, probability with target/horizon ID, and
data quality as separate fields. Version any eventual persisted detector state.

| Inspect                                                                                                                                                                                                | Reason                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [bars.py](../../lib/strategy-core/src/strategy_core/bars.py), [market.py](../../lib/strategy-core/src/strategy_core/market.py)                                                                         | Disjoint observations, extreme timestamps, status, and calendar ordinals           |
| [windows.py](../../lib/strategy-core/src/strategy_core/windows.py), [sliding-window design](../sliding-windows/design.md)                                                                              | Overlap and phase contracts                                                        |
| [features.py](../../lib/strategy-core/src/strategy_core/features.py), [indicators.py](../../lib/strategy-core/src/strategy_core/indicators.py)                                                         | Normalized feature definitions and calculation paths                               |
| [pipeline.py](../../lib/strategy-core/src/strategy_core/pipeline.py), [stages.py](../../lib/strategy-core/src/strategy_core/stages.py), [state.py](../../lib/strategy-core/src/strategy_core/state.py) | Stages, the pipeline, and checkpoint integration                                   |
| [engine.py](../../lib/strategy-core/src/strategy_core/engine.py), [engine timing](engine.md#timing-model)                                                                                              | Whole-session/incremental parity and actual availability                           |
| [labels.py](../../lib/strategy-core/src/strategy_core/labels.py)                                                                                                                                       | Existing fill-anchored trade outcomes; it is not an extreme-anchored pivot labeler |
| [test_windows_features.py](../../lib/strategy-core/tests/test_windows_features.py), [test_rows.py](../../lib/strategy-core/tests/test_rows.py)                                                         | Existing invariance, phase, state, and row tests                                   |

The current main at preparation time, `bfece3398946ebf8abc7b5900920a5109f46a2d5`, records
the first GC/SI ingest as completed. This documentation task did not query the database
or repeat ingestion. Before any experiment, read the current [ingestion handoff](handoff.md#rebuild-with-stages-gc-and-si),
check catalog/coverage/builder compatibility and `uv run research ingest status`, and
inspect degraded sessions. Do not assume current database state from this snapshot.

**Store correct deterministic values, then benchmark their usefulness.**

Implement and fixture-test the six-scale detector and structure, prove causal and
streaming/checkpoint parity, then pilot and store the fixed grid with dense second
features and sparse confirmed events. Join slow state as of its minute availability;
held values are context, not repeated confirmation events. Store future labels apart.
The benchmark selects later variants and validates quality; it does not gate initial
storage. Changing the grid must preserve builder/configuration provenance.

Define reference events independently of each detector's emitted candidates, using
predeclared finite-neighborhood and/or first-passage tasks. A DC detector matching its
own threshold events proves consistency, not universal pivot quality. Include missed
episodes, failed candidates, and data-quality exclusions in denominators.

Compare directional change, fixed-delay extrema, local-slope detection, and one
directional sequential test first. Then compare logistic regression and one GBDT on a
common candidate set. Run price-only, plus volume/aggression, then plus valid sampled
book ablations. Match alarms to reference events one-to-one by direction and scale;
report duplicates and pre-extreme predictions separately from post-extreme recognition.

Report precision/recall, false alarms per open hour, coverage, misses, duplicate burden,
median/tail delay in open rows and wall time, extreme-location error, and normalized
displacement from the extreme. For probabilities, add reliability diagrams, Brier score,
and log loss. Compare at matched recall or false-alarm burden; profit is not a gate.

Use chronological calendar blocks across products, group related candidates by episode,
purge overlapping outcomes, justify boundary gaps/embargo, fit all preprocessing and
calibration within training history, reserve the newest holdout, and estimate
uncertainty by session/calendar blocks. Predeclare the search budget.

If implementation is subsequently authorized, verify prefix invariance, whole-session
versus incremental parity, checkpoint continuation, scale invariance, plateaus, closures,
missing/no-trade rows, late trades, and rolls. Run `pnpm lint`, `pnpm test`, and
`pnpm build` for code changes; use the shared Git/PR review loop. Report measured results
and remaining uncertainty, including a negative result if added complexity does not help.

The [earlier proposal](../pivot-point-prediction-research.md) is historical context.
Its blanket future-label leakage claim, trade-label reuse, timeout handling, and
profitability selection gate are corrected in the reviewed research above.

Parallel follow-up interaction ID: `trun_1b14a132e79f4b7c80872f7a97006eef`.
