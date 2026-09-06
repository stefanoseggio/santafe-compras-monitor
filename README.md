# Santa Fe Compras Monitor

Extracts **public tenders** (licitaciones, contrataciones) from the
Province of Santa Fe, Argentina's official procurement system - via the
site's own read-only JSON API, with full detail per process on request:
description, rubros, organism, and direct links to downloadable documents
(pliego, resolucion, acta de apertura, cuadro comparativo).

## 🔔 Delta mode - daily/recurring monitoring, not just a dump

Set `onlyNew: true` and this actor persists which process ids it has
already returned (in its own private key-value store, per `estado`) and,
on every subsequent run, returns **only what's genuinely new since the
last run** - useful for a scheduled daily/hourly check that only wants to
know about freshly-listed tenders instead of re-downloading the whole
backlog every time.

```json
{ "estados": ["AP"], "onlyNew": true }
```

**Honesty note on how this is implemented**: this source's listing is
_not_ reliably sorted newest-first (verified live - `AP` sorts by soonest
upcoming opening date, and `ET`/`CO` show no correlation between position
and id/date at all), so `onlyNew` here is a **safe post-filter**, not an
early-stop optimization: every run still walks the listing up to
`maxItems` exactly as it always has, then filters to unseen ids. This
means a delta run costs the same requests as a normal run of that size -
slower than early-stop would be, but it can't silently miss a new record
that happens to land mid-listing. See `AGENTS.md` for the live evidence.

Run this on an Apify schedule and pipe the output straight into
Slack/Email/Zapier/Make/your own webhook via [Apify's native dataset
webhooks](https://docs.apify.com/platform/integrations/webhooks) - every
record already carries the standardized integration metadata below, so no
intermediate parser is needed.

Prefer filtering by the source's own opening-date field instead of
run-history? Use `dateRange` (`"24h"`, `"7d"`, or `"30d"`) - independent of
`onlyNew`. Note that `fechaHoraApertura` is a **scheduling** date, not a
publication date: for `AP` (upcoming openings) it's necessarily in the
_future_, so `dateRange` answers "opening in the next Nh/d", not
"discovered in the last Nh/d". `onlyNew` is the reliable "what's new"
signal for recurring monitoring; `dateRange` is there for when you
specifically want the source's own opening-date semantics (e.g. "what's
opening tomorrow").

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")

# Daily monitoring run - only genuinely new tenders come back
run = client.actor("stefano_seggio/santafe-compras-monitor").call(run_input={"onlyNew": True})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(f"[{item['event_type']}] {item['comprador']} - {item['source_url']}")
    # -> forward `item` as-is to your webhook/Slack/CRM; the record_id/
    #    event_type/scraped_at/source_url envelope needs no reshaping.
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });

// Daily monitoring run
const run = await client.actor('stefano_seggio/santafe-compras-monitor').call({ onlyNew: true });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
for (const item of items) {
    // item.record_id / item.event_type / item.scraped_at / item.source_url
    // are already webhook/Zapier/Make-ready - post `item` straight through.
}
```

**Webhook / Zapier / Make**: configure an [Apify dataset webhook](https://docs.apify.com/platform/integrations/webhooks)
on `ACTOR.RUN.SUCCEEDED` for this actor and point it at your endpoint - the
standardized `record_id`/`event_type`/`scraped_at`/`is_new`/`source_url`
envelope on every item means no custom parser is needed on the receiving
end.

## What you get

Every record carries this standardized B2B integration envelope:

| Field        | Type    | Description                                          |
| ------------ | ------- | ---------------------------------------------------- |
| `record_id`  | string  | `idGestion` - stable across runs                     |
| `event_type` | string  | Always `NEW_LISTING` (see Known limitations for why) |
| `scraped_at` | string  | ISO-8601 timestamp of this extraction                |
| `is_new`     | boolean | `true` if not seen in a prior run (delta mode)       |
| `source_url` | string  | Direct link to the official detail page              |

Plus the full domain detail:

| Field                           | Description                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `idGestion`                     | Process ID                                                                                                     |
| `estado`                        | `AP` (upcoming opening), `ET` (in progress) or `CO` (concluded/awarded)                                        |
| `tipoGestion`                   | Type, e.g. "LICITACIÓN PÚBLICA"                                                                                |
| `numeroGestion` / `anioGestion` | Process number and year                                                                                        |
| `fechaHoraApertura`             | Opening date                                                                                                   |
| `objeto`                        | Short subject                                                                                                  |
| `comprador`                     | Buying organism                                                                                                |
| `valorPliego`                   | Bid document price                                                                                             |
| `numeroExpediente`              | File number, when published                                                                                    |
| `detail.fields`                 | Full labeled detail (description, modalidad, alcance, organismo comitente/licitante, montos, lugares y fechas) |
| `detail.rubros`                 | Category/subcategory list                                                                                      |
| `detail.documentos`             | Downloadable documents: `{tipo, nombre, url}`                                                                  |

## Input

| Field         | Type    | Default  | Description                                                            |
| ------------- | ------- | -------- | ---------------------------------------------------------------------- |
| `estados`     | array   | `["AP"]` | Which process states to fetch: `AP`, `ET`, `CO`                        |
| `fetchDetail` | boolean | `true`   | Fetch full detail per process (one extra request each)                 |
| `maxItems`    | integer | `100`    | Hard cap on processes returned this run                                |
| `onlyNew`     | boolean | `false`  | Delta mode - see above                                                 |
| `dateRange`   | string  | (none)   | `"24h"` \| `"7d"` \| `"30d"` - filter by the source's own opening date |

```json
{ "estados": ["AP"], "fetchDetail": true, "maxItems": 100, "onlyNew": false }
```

## Usage

```bash
# One-off extraction
curl "https://api.apify.com/v2/acts/stefano_seggio~santafe-compras-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"estados": ["AP"], "maxItems": 100}'

# Daily monitoring (schedule this call every few hours)
curl "https://api.apify.com/v2/acts/stefano_seggio~santafe-compras-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"estados": ["AP"], "onlyNew": true}'
```

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/santafe-compras-monitor").call(run_input={"estados": ["AP"], "maxItems": 100})
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(item["idGestion"], item["comprador"], item["objeto"])
```

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/santafe-compras-monitor').call({ estados: ['AP'], maxItems: 100 });
const { items } = await client.dataset(run.defaultDatasetId).listItems();
```

## Known limitations

- No proxy needed - the source is reachable from a plain datacenter IP.
- `anio` (year) isn't exposed as a filter - tested live and it doesn't
  appear to change the API's response.
- `fetchDetail: true` adds one request per process; disable it for a
  faster listing-only pass when full detail isn't needed.
- `onlyNew` is a safe post-filter, not an early-stop optimization - this
  source's listing order isn't reliably newest-first for any `estado`, so
  a delta run still walks up to `maxItems` records every time rather than
  short-circuiting once it hits known ids. See `AGENTS.md` for the live
  verification behind this.
- `event_type` is always `NEW_LISTING` - this domain has no signal as
  specific as e.g. a conviction being an imposed sanction: a `CO`
  (Concluido) process's own detail page has no awardee field and its
  `Estado` label just reads "CONCLUIDA" regardless of outcome, so there's
  no defensible way to label a subset as "awarded" without new scraping
  this pass doesn't do. It also doesn't diff field-level changes to a
  previously-seen record (e.g. a process moving from `ET` to `CO`) beyond
  tracking `estado` per id separately - a bigger feature deferred for now.

Full technical detail is in `AGENTS.md`.
