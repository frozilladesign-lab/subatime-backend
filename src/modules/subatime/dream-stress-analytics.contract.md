# Dream Stress Analytics API Contract

Endpoint: `GET /api/subatime/analytics/dream-stress`

Auth: Bearer token required (same guard as other `/api/subatime/*` endpoints).

Query params:
- `days` (optional): `30` or `90`
- default: `30`

## Response Shape

Envelope:

```json
{
  "message": "Dream stress analytics fetched",
  "data": {
    "summaryStats": {
      "windowDays": 30,
      "totalEntries": 14,
      "daysWithEntries": 11,
      "averageStress": 0.4137,
      "last7AverageStress": 0.355,
      "first7AverageStress": 0.5042,
      "stressDelta": -0.1492,
      "mostCommonBand": "mild"
    },
    "trendSeries": [
      {
        "date": "2026-04-10",
        "entryCount": 1,
        "averageStress": 0.63,
        "movingAverage7": 0.63
      }
    ],
    "stressBands": {
      "stable": 3,
      "mild": 7,
      "elevated": 3,
      "overload": 1
    },
    "themeBreakdown": [
      { "label": "unfinished business", "count": 5 },
      { "label": "being chased", "count": 4 }
    ],
    "symbolBreakdown": [
      { "label": "water", "count": 6 },
      { "label": "stairs", "count": 3 }
    ]
  }
}
```

## Field Semantics (Flutter parsing guide)

- `summaryStats.windowDays`: always `30` or `90`.
- `summaryStats.totalEntries`: total dream rows in selected window.
- `summaryStats.daysWithEntries`: number of UTC days where `entryCount > 0`.
- `summaryStats.averageStress`: average of non-null daily averages across the whole window; nullable.
- `summaryStats.last7AverageStress`: average of non-null daily averages in latest 7 buckets; nullable.
- `summaryStats.first7AverageStress`: average of non-null daily averages in earliest 7 buckets; nullable.
- `summaryStats.stressDelta`: `last7AverageStress - first7AverageStress`; nullable.
- `summaryStats.mostCommonBand`: one of `stable | mild | elevated | overload`, else `null`.

- `trendSeries`: always dense for the full window (30/90 items), one per UTC day.
  - `date`: `YYYY-MM-DD` (UTC bucket key).
  - `entryCount`: number of dream entries on that day.
  - `averageStress`: nullable when no analyzable stress values for that day.
  - `movingAverage7`: nullable when the trailing non-null window is empty.

- `stressBands`: counts by canonical band.
- `themeBreakdown`: top themes sorted desc by count (up to 12 rows).
- `symbolBreakdown`: top symbols sorted desc by count (up to 12 rows).

## Zero/Sparse State Rules

The endpoint is intentionally null-safe:
- no entries -> no 500, returns:
  - `summaryStats.totalEntries = 0`
  - averages/delta/band = `null`
  - dense `trendSeries` with `entryCount = 0`, `averageStress = null`, `movingAverage7 = null`
  - `themeBreakdown = []`
  - `symbolBreakdown = []`
  - `stressBands` all zeros
- sparse days -> missing days remain explicit with `null` averages (do not coerce to `0`).

## Example: `days=90` Sparse Response

```json
{
  "message": "Dream stress analytics fetched",
  "data": {
    "summaryStats": {
      "windowDays": 90,
      "totalEntries": 2,
      "daysWithEntries": 2,
      "averageStress": 0.41,
      "last7AverageStress": null,
      "first7AverageStress": 0.41,
      "stressDelta": null,
      "mostCommonBand": "mild"
    },
    "trendSeries": [
      { "date": "2026-02-10", "entryCount": 0, "averageStress": null, "movingAverage7": null },
      { "date": "2026-02-11", "entryCount": 1, "averageStress": 0.38, "movingAverage7": 0.38 }
    ],
    "stressBands": {
      "stable": 0,
      "mild": 2,
      "elevated": 0,
      "overload": 0
    },
    "themeBreakdown": [{ "label": "school exam", "count": 1 }],
    "symbolBreakdown": [{ "label": "running", "count": 1 }]
  }
}
```
