# `@subatime/jyotisha-engine` — Accuracy Summary

This is a short, package-local pointer. The full methods-and-accuracy report (theory, formulas, verification methodology, regression-test inventory, open items) lives at
[`docs/jyotisha-engine-methods-and-accuracy.md`](../../docs/jyotisha-engine-methods-and-accuracy.md) in the repo root — read that for details. This file states the headline guarantees and limits.

## What this package does NOT claim

- **No prediction from this package is "100% accurate."** Astronomical positions can be verified against Swiss Ephemeris; classical rule application can be verified against the documented rule; product scoring and interpretation cannot be "verified" in that sense — it is a chosen weighting model, not a measurement.
- Astronomical accuracy, classical-rule accuracy, and product/heuristic interpretation are three different things and are never presented as the same thing. See `AccuracyTier` below.

## The four accuracy tiers

Every major result (`chart`, `dasha`, scoring blocks, daily transit cards, Manglik analysis, Aṣṭakūṭa matching) carries an `accuracy` (or flat `accuracyTier`/`degraded`) field using this shared vocabulary (`types/chart.ts`):

| Tier | Meaning | Where it appears |
|---|---|---|
| `ephemeris` | Swiss Ephemeris astronomical calculation. Sub-degree accurate. | Chart engine, Swiss path (`CHART_ENGINE` unset, `swiss`, or `strict-swiss`) |
| `approximate` | Legacy mean-orbit math. **Not production-grade** — see warning below. | Chart engine, legacy path (`CHART_ENGINE=legacy`, or silent dev-mode fallback) |
| `classical-rule` | A documented classical Jyotiṣya rule applied deterministically and exactly. Not an astronomical measurement; regional/lineage variation in the rule itself may exist. | Manglik analysis, Aṣṭakūṭa koota scoring, Vimśottarī lord sequence |
| `heuristic` | Product/scoring interpretation model — not a verifiable astronomical or classical-rule fact. | Time-block scoring (`scoreBreakdown`), heuristic compatibility |

## Chart engine modes (`CHART_ENGINE` env var)

- **`strict-swiss`** — production-recommended. Swiss Ephemeris failure throws a typed `ChartCalculationError`; there is no fallback to legacy math.
- **`swiss`** / unset — Swiss Ephemeris is attempted; only on failure does it fall back to legacy math, and that fallback chart is always stamped `degraded: true`, `accuracyTier: "approximate"`. Intended for development convenience, not as a silent production path.
- **`legacy`** — forces the legacy mean-orbit/ascendant formulas. Always stamped degraded. Dev/test only.

**Legacy calculations are approximate and may be wrong near sign, nakṣatra, pāda, aspect, or house boundaries. They must not be used for production-grade chart interpretation.** The legacy ascendant formula in particular has an unresolved 90°+ drift bug (see the full report).

## Vimśottarī Mahādaśā

Birth-balance is computed from the Moon's actual elapsed/remaining degrees within its birth nakṣatra (13°20′ span), not just a coarse nakṣatra index — `firstDashaBalanceYears = startingLordFullYears × (remainingDegrees / 13°20′)`. The 9-lord cycle always sums to exactly 120 years (tested). Antardaśā uses the standard proportional formula.

## Daily transit cards

Computed from a real transit-Moon longitude and angular-separation checks against natal Moon/Sun/ascendant within configured orbs (conjunction 8°, sextile 5°, square 6°, trine 7°, opposition 8°). A card only appears when its aspect condition is actually true (`isComputed: true`); otherwise a neutral "Steady Lunar Influence" card is returned. The old static/hash-selected card pool exists only as an explicitly `degraded: true`, `isComputed: false` fallback for callers without natal longitudes.

## Scoring

The time-block scoring formula is a **weighted interpretation model based on selected Jyotiṣya signals** — not objective astrology. `scoreBreakdown` exposes every component's raw value, weight, weighted contribution, type (`heuristic`/`product`), and explanation. Component weights are tested to sum to exactly 1.0.

## Compatibility — two independent methods

- `compareHeuristicCompatibility` — product scoring (communication/intimacy/long-term/emotional), `method: "heuristic"`.
- `compareAshtakootaCompatibility` — classical 8-koota guṇa matching out of 36 (Varna/Vashya/Tara/Yoni/Graha Maitri/Gana/Bhakoot/Nadi), `method: "ashtakoota"`, `accuracy.tier: "classical-rule"`. Ships with explicit `warnings` calling out its documented simplifications (whole-sign Vashya, flattened Yoni matrix, symmetric Gana cross-scoring) and a reminder that **regional/lineage variations of Aṣṭakūṭa exist** — this is one documented, deterministic application, not the only correct one.

These two methods are never averaged or combined into a single number.

## Manglik / Mars doṣa

Default rule (Mars in houses 1, 4, 7, 8, 12 from ascendant) plus optional Moon-based and Venus-based secondary checks, each labeled in `rulesUsed`/`notes` and tagged `accuracy.tier: "classical-rule"`.

## Pañcāṅga / almanac (`almanac/`)

Moved here from the backend (`AlmanacService` is now a thin NestJS orchestrator only — caching and HTTP error translation, no math). `computePanchanga` assembles:

- **Sunrise/sunset/next-sunrise** (`computeSunriseSunset`) — real Swiss Ephemeris rise/transit/set. `tier: "ephemeris"`.
- **Tithi** (`computeTithi`), **yoga** (`computeYoga`), **nakṣatra snapshot** (`computeNakshatraSnapshot`) — deterministic arithmetic on real sidereal Sun/Moon longitudes. `tier: "ephemeris"`. Karaṇa is returned as a stable 0–59 index only — names vary by tradition and are not asserted.
- **Horā timeline** (`computeHoraTimeline`) and **Rāhu kāla / Yamagaṇḍa / Gulika / Maru diśā** (`computeRahuKalam`) — segment boundaries are real ephemeris-derived sunrise/sunset/next-sunrise instants, but slot/lord assignment is a classical weekday lookup. `tier: "classical-rule"`, not `"ephemeris"` — an intentionally more precise label than a blanket astronomical claim. Horā `personalStatus` (favorable/tense/neutral) is a separate **heuristic** lagna benefic/malefic table, flagged as such in `notes`.

`GET /calendar/day` (backend) returns the exact same JSON shape as before this migration, plus the additive `accuracy` block — verified live against a local database for the Colombo 2024-01-15 reference date, including cache behavior and the exact `400` error message on an invalid timezone.

## Multi-location accuracy fixtures (`fixtures/accuracy/`)

Six location fixtures (Colombo, Chennai, Delhi, London, New York, Sydney), each declaring `sourceType: "external-verified" | "engine-self-consistency"`:

- **Colombo (2024-01-15)** is `"external-verified"` — checked against drikpanchang.com (already the project's existing reference). Ayanāṃśa, Sun/Moon sidereal sign, Moon nakṣatra, and sunrise/sunset all match within documented tolerance.
- **Chennai, Delhi, London, New York, Sydney (2024-06-15)** are `"engine-self-consistency"` — generated once by running this same engine and stored as regression/determinism guards. **These do not prove the engine is astronomically correct for those locations** — only that it hasn't silently changed. Each fixture's `sourceNote` says this explicitly.
- Fields within ~1–2° of a sign/nakṣatra boundary at the fixture's exact instant are listed in `boundarySensitiveFields` and asserted with a "how close to the boundary" check instead of strict equality (e.g. Sun sign for most fixtures, since these dates sit near a sāṅkrāntiḷ; Sydney's Moon nakṣatra, which is ~0.12° from a cusp).

## Known gaps (not attempted yet)

- Genuine independent (non-self-generated) verification for Chennai/Delhi/London/New York/Sydney — a second ephemeris or a published pañcāṅga per city — has not been done.
- Aṣṭakūṭa is not yet surfaced in any frontend screen (backend route exists).
- Real daily transit cards are English-only; the Sinhala plan-day path still uses the static, clearly-`degraded` fallback pool.
