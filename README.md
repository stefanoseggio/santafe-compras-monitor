# Santa Fe Compras Monitor

Extracts **public tenders** (licitaciones, contrataciones) from the
Province of Santa Fe, Argentina's official procurement system - via the
site's own read-only JSON API, with full detail per process on request:
description, rubros, organism, and direct links to downloadable documents
(pliego, resolucion, acta de apertura, cuadro comparativo).

## What you get

| Field | Description |
|---|---|
| `idGestion` | Process ID |
| `estado` | `AP` (upcoming opening), `ET` (in progress) or `CO` (concluded/awarded) |
| `tipoGestion` | Type, e.g. "LICITACIÓN PÚBLICA" |
| `numeroGestion` / `anioGestion` | Process number and year |
| `fechaHoraApertura` | Opening date |
| `objeto` | Short subject |
| `comprador` | Buying organism |
| `valorPliego` | Bid document price |
| `numeroExpediente` | File number, when published |
| `detailUrl` | Link to the official detail page |
| `detail.fields` | Full labeled detail (description, modalidad, alcance, organismo comitente/licitante, montos, lugares y fechas) |
| `detail.rubros` | Category/subcategory list |
| `detail.documentos` | Downloadable documents: `{tipo, nombre, url}` |
| `scrapedAt` | ISO timestamp of extraction |

## Input

| Field | Type | Default | Description |
|---|---|---|---|
| `estados` | array | `["AP"]` | Which process states to fetch: `AP`, `ET`, `CO` |
| `fetchDetail` | boolean | `true` | Fetch full detail per process (one extra request each) |
| `maxItems` | integer | `100` | Hard cap on processes returned this run |

```json
{ "estados": ["AP"], "fetchDetail": true, "maxItems": 100 }
```

## Usage

```bash
curl "https://api.apify.com/v2/acts/stefano_seggio~santafe-compras-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"estados": ["AP"], "maxItems": 100}'
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

Full technical detail is in `AGENTS.md`.
