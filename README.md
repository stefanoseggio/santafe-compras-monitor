# Santa Fe Tenders Scraper & Monitor (Licitaciones Santa Fe)

**The tender-alert API the Province of Santa Fe never shipped.** This Actor turns the official **Gestiones de Compra register of the Province of Santa Fe, Argentina** (santafe.gov.ar/gestionesdecompras) - every _licitación pública, licitación privada, concurso, contratación directa, subasta_ and _convenio marco_ of the provincial ministries, hospitals, SAMCOs, Aguas Santafesinas, airports and Lotería, 31,000+ processes since 2000 - into clean JSON/CSV with **buyer, requesting body, budget (Monto Original), submission deadline, opening date, rubros, expediente, contact and direct PDF links to pliegos, circulares, actas and preadjudicación reports**, and keeps it fresh: put it on a schedule with _Only new_ switched on and each run returns just the tenders that were **published, changed status (AP -> ET -> CO) or amended since the last run**.

[![Santa Fe Tenders Scraper & Monitor](https://apify.com/actor-badge?actor=stefano_seggio/santafe-compras-monitor)](https://apify.com/stefano_seggio/santafe-compras-monitor)

- **Search like the site, at API speed** - estado, year, subject, procedure type, modality, buyer, requesting body, rubro / sub-rubro, process and file number are applied by the register's own JSON API, so a narrow run is one request. Buyers and rubros can be given by name ("Hospital Cullen", "medicamentos").
- **See what nobody else sees** - the listing has no publication or modification date and amendments (a _circular aclaratoria_, an _acta de apertura_, an _informe de preadjudicación_) leave no trace in it. This Actor re-reads the detail page of every known open process, fingerprints it, and tags every row `NEW_LISTING`, `STATUS_CHANGE` or `UPDATED`.
- **Warehouse-ready, not screen-scraped** - every raw site string comes with a normalised twin: UTC instants for publication, deadline and opening (Santa Fe is UTC-3), numeric budget with currency (ARS or USD), days until deadline, electronic-bid flag and link, document kinds (`pliego`, `circular`, `acta_apertura`, `preadjudicacion`, `adjudicacion`, `orden_provision`...), split rubro / sub-rubro, contact e-mails and phones.
- **No browser, no proxy, no login.** Plain HTTP against the site's own read-only JSON endpoint, 256 MB of memory, pay per record.

## What is the Santa Fe Gestiones de Compra register?

Under Ley 12.510 (the province's public administration and control law) every purchasing body of the Province of Santa Fe must publish its procurement processes on the _Gestiones de Compra_ portal: who is buying what, the budget, the pliego, the deadline and the opening, and later the acta de apertura, the price comparison, the pre-award report and the award. It is the only complete, official record of provincial procurement - roughly 1,100 new processes a year, dominated by hospital and SAMCO purchases (medicines, supplies, cleaning, food) and by ministry services and works, with individual budgets from a few million to hundreds of millions of pesos.

The portal has a search form that defaults to the current year, a CSV export without ids, amounts or links, **no alerts, no RSS and no API documentation**. Deadlines are short (a contratación directa published on a Friday can close the following Monday). This Actor is the missing layer. Start from the register at [santafe.gov.ar/gestionesdecompras](https://www.santafe.gov.ar/gestionesdecompras/site/).

## Quick start

1. Click **Try for free**. The default input reads the upcoming openings (AP) and the in-progress list (ET) newest-first and returns the 100 most recently created processes with full detail - under a minute and $0.30.
2. Open the **Output** tab: five ready-made views (Overview, Deadlines & openings, Documents & awards, Buyers & contacts, Status changes & amendments) or export **JSON, CSV or Excel**.
3. Narrow it: set _Subject contains_ to `limpieza`, pick procedure types, type a buyer name, a rubro, or an opening-date window such as `+14 days`.
4. Monitor it: keep **Only new** on, add an [Apify Schedule](https://docs.apify.com/platform/schedules) (every 6 or 24 hours) and a [webhook](https://docs.apify.com/platform/integrations/webhooks) or the Slack / Make / Zapier integration. From the second run on you only pay for what actually changed.

## Who uses Santa Fe procurement data

| Team                                                                                                    | Question they ask                                                                       | Fields that answer it                                                                          | Decision                                                                   |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Suppliers to the provincial health system (pharma and medical-supply distributors, lab, cleaning, food) | Which hospital or SAMCO published a tender in my rubro today, and when does it close?   | `rubroNames`, `comprador`, `submissionDeadline`, `daysUntilDeadline`, `montoOriginalAmount`    | Bid / no-bid inside a 1-3 day window; download the pliego from `documents` |
| Construction, IT, security and facility-service contractors                                             | Which ministries are buying services like mine, at what budget, electronic or on paper? | `objeto`, `organismoComitente`, `montoOriginalAmount`, `isElectronic`, `bidUrl`                | Route the opportunity to the right sales owner, register on gestionvirtual |
| Bid consultants and _gestores de licitaciones_                                                          | Did any of my clients' open tenders get a circular or a new opening date?               | `event_type = UPDATED`, `hasCircular`, `openingNote`, `documents`                              | Re-check the draft offer before the deadline                               |
| Tender-alert vendors and LATAM data resellers                                                           | A reliable, structured Santa Fe feed with change events and document links              | the whole envelope (`record_id`, `event_type`, `scraped_at`, `is_new`, `source_url`)           | Buy vs build one of 400+ provincial scrapers                               |
| Competitors and market analysts                                                                         | Who was awarded what? Which processes reached preadjudicación or orden de provisión?    | `hasPreadjudicacion`, `hasAdjudicacion`, `hasOrdenProvision`, `documents` (cuadro comparativo) | Price benchmarking from the published comparison tables                    |
| Transparency NGOs, journalists, academics                                                               | How much direct contracting does organism X do, and how has it grown?                   | `tipoGestionCode = T`, `comprador`, `montoOriginalAmount`, `publishedDate`, `anioGestion`      | Spending analysis by organism, rubro and year; one-off archive pulls       |

## Sample output

One real record (the `detail` object and a few long strings trimmed; every record carries all 84 fields listed below):

```json
{
    "record_id": "139031",
    "event_type": "NEW_LISTING",
    "scraped_at": "2026-09-08T07:24:09.044Z",
    "is_new": true,
    "source_url": "https://www.santafe.gov.ar/gestionesdecompras/site/gestion.php?idGestion=139031",
    "data_source": "Gestiones de Compra - Gobierno de la Provincia de Santa Fe (santafe.gov.ar/gestionesdecompras), CC BY-SA 2.5 AR",
    "idGestion": "139031",
    "estado": "AP",
    "tipoGestion": "LICITACIÓN PÚBLICA",
    "tipoGestionCode": "L",
    "numeroGestion": "06",
    "anioGestion": "2026",
    "numeroAnio": "06-2026",
    "objeto": "CONTRATACIÓN DE UN SERVICIO DE MANTENIMIENTO PREVENTIVO Y CORRECTIVO PARA CENTRAL TELEFÓNICA HARRIS...",
    "comprador": "MINISTERIO DE GOBIERNO E INNOVACIÓN PÚBLICA",
    "organismoComitente": ["MINISTERIO DE GOBIERNO E INNOVACIÓN PÚBLICA"],
    "fechaHoraApertura": "28-09-2026",
    "openingAt": "2026-09-28T13:00:00.000Z",
    "daysUntilOpening": 20,
    "isOpeningInFuture": true,
    "publishedAtLocal": "07-09-2026 15:54 Hs.",
    "publishedAt": "2026-09-07T18:54:00.000Z",
    "estadoLabel": "PARA APERTURA",
    "montoOriginalText": "U$S 60.000,00",
    "montoOriginalAmount": 60000,
    "montoOriginalCurrency": "USD",
    "valorPliego": "NO CORRESPONDE",
    "valorPliegoIsFree": true,
    "rubros": [{ "rubro": "EQUIPOS Y ACCESORIOS DE COMUNICACION", "subrubro": "EQUIPOS Y ACCESORIOS DE COMUNICACION" }],
    "submissionPlace": "EL PROVEEDOR A EFECTOS DE LA PRESENTACIÓN DE SU OFERTA, DEBERÁ INGRESAR AL SIGUIENTE LINK: HTTPS://GESTIONVIRTUAL.SANTAFE.GOB.AR",
    "contactInfo": "(0342) 450-6600 INTERNO 1302 - 1593 - COMPRASMGP@SANTAFE.GOV.AR",
    "contactEmails": ["comprasmgp@santafe.gov.ar"],
    "contactPhones": ["(0342) 450-6600"],
    "expediente": "EE-2026-00006835-APPSF-PE",
    "expedienteUrl": "https://www.santafe.gov.ar/expedientes-web/expediente-timbo/?anioTimbo=2026&numeroTimbo=00006835&tipoReparticion=APPSF&reparticionTimbo=PE&tipoTimbo=1&buscarTimbo=Buscar",
    "isElectronic": true,
    "bidUrl": "https://gestionvirtual.santafe.gob.ar/#/bandeja_proveedores/create/form/680a87a12a055d2295ea39a0?expedienteCode=EE-2026-00006835-APPSF-PE",
    "documents": [
        {
            "kind": "pliego",
            "tipo": "Pliego",
            "nombre": "PLIEGO ÚNICO DE BASES Y CONDICIONES GENERALES",
            "url": "https://www.santafe.gov.ar/gestionesdecompras/descargar.php?m=anexo&id=171910&hash=8cd5df74023f7e1c8c86cc954d783796&panel=0",
            "id": "171910"
        },
        {
            "kind": "pliego",
            "tipo": "Pliego",
            "nombre": "PLIEGO DE BASES Y CONDICIONES PARTICULARES",
            "url": "https://www.santafe.gov.ar/gestionesdecompras/descargar.php?m=anexo&id=171911&hash=eb5f80ad8d89a3f52acb2e49d71c981d&panel=0",
            "id": "171911"
        },
        {
            "kind": "otros",
            "tipo": "Otros",
            "nombre": "MODELO NOTA - DOCUMENTACIÓN PROVEEDOR",
            "url": "https://www.santafe.gov.ar/gestionesdecompras/descargar.php?m=anexo&id=171912&hash=9c40831a21be3116b1d37ca9eae216c2&panel=0",
            "id": "171912"
        }
    ],
    "documentCount": 4,
    "hasPliego": true,
    "hasCircular": false,
    "printPdfUrl": "https://www.santafe.gov.ar/gestionesdecompras/site/output.php?a=gestiones.ver&idGestion=139031&print=1",
    "detailFetched": true,
    "contentHash": "62c66a944a7fd695e0dbfe1cefec285c945fda10"
}
```

A status change looks the same with `"event_type": "STATUS_CHANGE"`, `"previousEstado": "AP"`, `"estado": "ET"`; an amendment with `"event_type": "UPDATED"`, `"is_new": false` and, typically, `"hasCircular": true` or a new `openingNote` such as `(*** NUEVA FECHA ***)`.

## Output fields

**Integration envelope** (identical across all of this developer's public-register Actors, so one webhook parser serves them all):

| Field         | Type    | Description                                                                                                                                                                                       |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record_id`   | string  | Same as `idGestion` - stable across runs                                                                                                                                                          |
| `event_type`  | string  | `NEW_LISTING` (never delivered before), `STATUS_CHANGE` (a known process moved AP -> ET -> CO), `UPDATED` (a known open process whose detail page changed: circular, acta, preadjudicación, date) |
| `scraped_at`  | string  | ISO-8601 UTC timestamp of the extraction                                                                                                                                                          |
| `is_new`      | boolean | `true` if never delivered by a previous run of this delta memory                                                                                                                                  |
| `source_url`  | string  | The official detail page                                                                                                                                                                          |
| `data_source` | string  | Attribution string (CC BY-SA 2.5 AR)                                                                                                                                                              |

**Process** - the version-1 fields and the `detail` object are kept verbatim; normalised twins sit next to them:

| Group                        | Fields                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity (v1)                | `idGestion`, `estado`, `tipoGestion`, `numeroGestion`, `anioGestion`, `fechaHoraApertura`, `objeto`, `comprador`, `valorPliego`, `numeroExpediente`, `detail` (`fields`, `rubros`, `documentos`)                                                                                                                                                                                                                                                                            |
| Listing twins                | `idGestionNumber`, `numeroAnio`, `tipoGestionCode`, `tipoModalidad`, `idOrganismoGestion`, `objetoCompleto`, `destinos`, `fechaHoraAperturaFija` / `openingAt` / `openingDate` / `daysUntilOpening` / `isOpeningInFuture`, `valorPliegoAmount` / `valorPliegoCurrency` / `valorPliegoIsFree`, `previousEstado`, `isElectronic`, `bidUrl`, `printPdfUrl`, `documentsUrl`                                                                                                     |
| Detail (`fetchDetail: true`) | `estadoLabel` / `estadoStage` / `estadoFromDetail`, `publishedAtLocal` / `publishedAt` / `publishedDate` / `daysSincePublished`, `modalidad`, `alcance`, `descripcion`, `rubros[]` / `rubroNames` / `subrubroNames`, `organismoComitente[]`, `organismoLicitante`, `submissionPlace`, `submissionDeadlineLocal` / `submissionDeadline` / `daysUntilDeadline`, `openingPlace`, `openingAtDetailLocal`, `openingNote`, `deliveryPlaceAndDate`, `valorPliegoDetail`, `notes[]` |
| Money                        | `montoOriginalText`, `montoOriginalAmount`, `montoOriginalCurrency` (`ARS` or `USD`; never converted - compare with `publishedDate` under Argentine inflation)                                                                                                                                                                                                                                                                                                              |
| Files & contact              | `expedientes[]` (`label`, `code`, `url`), `expediente`, `expedienteUrl`, `contactInfo`, `contactEmails[]`, `contactPhones[]`                                                                                                                                                                                                                                                                                                                                                |
| Documents                    | `documents[]` (`kind`, `tipo`, `nombre`, `url`, `id`), `documentCount`, `documentKinds[]`, `hasPliego`, `hasCircular`, `hasActaApertura`, `hasCuadroComparativo`, `hasPreadjudicacion`, `hasAdjudicacion`, `hasOrdenProvision`. Kinds: `pliego`, `circular`, `llamado`, `acta_apertura`, `nomina_oferentes`, `cuadro_comparativo`, `informe_comision`, `preadjudicacion`, `adjudicacion`, `orden_provision`, `documento_provision`, `planimetria`, `otros`                  |
| Provenance                   | `detailFetched`, `detailError` (`UNPUBLISHED` when the site says the process is not published), `contentHash` (the delta engine's change key)                                                                                                                                                                                                                                                                                                                               |

Records are appended **oldest-first within a run** (that is what makes delta mode crash-safe - see _How monitoring works_). The Output views show newest first; on the API add `?desc=true`.

## Input

Every filter is applied server-side by the register's JSON API unless marked otherwise.

| Field                      | Type     | Default                    | Description                                                                                                                                                                        |
| -------------------------- | -------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `estados`                  | string[] | `["AP"]`                   | Lists to read: `AP` Para Apertura (where every new tender appears first), `ET` En Trámite, `CO` Concluida. One query each                                                          |
| `anio`                     | integer  | -                          | Year of the process number (the site's own UI always applies the current year; empty = all years)                                                                                  |
| `objeto`                   | string   | -                          | Phrase search over the subject (`limpieza`, `servicio de vigilancia`)                                                                                                              |
| `tipoGestion`              | string[] | `[]`                       | Procedure types by site code: `L` Licitación Pública, `P` Privada, `A` Acelerada, `T` Contratación Directa, `B`/`V`/`C` Concursos, `S` Subasta, `X` Competitivo Ágil, `O` Otros... |
| `tipoModalidad`            | string   | -                          | Modality code: `1` Sin Modalidad, `2` Convenio Marco, `3` Contratación Unificada, `4` Orden de Compra Abierta, `5` Subasta Inversa, `6` Llave en Mano, `7` Consumo Convenio Marco  |
| `comprador`, `solicitante` | string   | -                          | Buyer (organismo licitante) / requesting body (comitente) by site id or by name (`Hospital Cullen`, `Ministerio de Salud`); resolved against the site's organism list at run start |
| `rubro`, `subrubro`        | string   | -                          | Category / sub-category by id or by name (`medicinales`, `limpieza`); sub-rubro needs a rubro                                                                                      |
| `nroGestion`               | string   | -                          | Exact process number (`18`)                                                                                                                                                        |
| `nroExpediente`            | string   | -                          | Exact, full file number (`EE-2026-00001797-APPSF-OD`)                                                                                                                              |
| `openingFrom`, `openingTo` | string   | -                          | Opening-date window, **client-side** (the site has no date filter): `2026-09-01`, `7 days` (back), `+30 days` (forward)                                                            |
| `eventTypes`               | string[] | all three                  | Which of `NEW_LISTING`, `STATUS_CHANGE`, `UPDATED` to deliver                                                                                                                      |
| `onlyNew`                  | boolean  | `false`                    | Delta mode - see below                                                                                                                                                             |
| `recheckWindowDays`        | integer  | `30`                       | Delta mode: known processes opening within this many days (past) or any time in the future get their detail page re-read for amendments; `0` disables                              |
| `sortBy`                   | string   | `newest`                   | `newest` (required for delta), `openingSoonest`, `openingLatest`, `mostViewed`                                                                                                     |
| `deltaStateName`           | string   | fingerprint of the filters | Name of the delta memory; share it between tasks on purpose, never by accident                                                                                                     |
| `resetState`               | boolean  | `false`                    | Forget delivered processes and re-baseline                                                                                                                                         |
| `maxItems`                 | integer  | `100`                      | Cap on delivered records per run (and on cost). Max 100,000                                                                                                                        |
| `fetchDetail`              | boolean  | `true`                     | Open each process page for publication time, budget, deadline, places, rubros, contact, expediente and document links                                                              |
| `maxConcurrency`           | integer  | `5`                        | Parallel detail-page requests (1-10)                                                                                                                                               |

### Ready-to-run examples

**Daily monitor of every new, changed or amended open tender**

```json
{ "estados": ["AP", "ET"], "onlyNew": true, "maxItems": 500 }
```

**Hospital medicines and medical supplies, monitored**

```json
{ "estados": ["AP"], "rubro": "medicinales", "onlyNew": true, "maxItems": 300 }
```

**Cleaning-service tenders of 2026, any state, listing-only**

```json
{ "estados": ["AP", "ET", "CO"], "objeto": "limpieza", "anio": 2026, "fetchDetail": false, "maxItems": 2000 }
```

**Everything one buyer has ever tendered (by name)**

```json
{ "estados": ["CO"], "comprador": "Administración Provincial de Impuestos", "maxItems": 1000 }
```

**Direct contracting only, opening in the next two weeks**

```json
{ "estados": ["AP"], "tipoGestion": ["T"], "openingFrom": "today", "openingTo": "+14 days", "maxItems": 200 }
```

(`"today"` is written as `"0 days"`.)

**Concluded public tenders of 2025 for spending analysis**

```json
{ "estados": ["CO"], "tipoGestion": ["L"], "anio": 2025, "maxItems": 5000 }
```

## How monitoring works (delta mode)

1. The first run with `onlyNew: true` walks each selected estado list **newest-created first** (`idGestion` descending - verified to paginate contiguously) and delivers up to `maxItems` processes, remembering for each one the list it was in and a fingerprint of its detail page in a private, named key-value store (`santafe-compras-monitor-state-<deltaStateName>`). That first run is the **baseline**: anything created before the oldest process it delivered is treated as history and is never delivered later - so a small `maxItems` on the first run keeps the baseline cheap without turning later runs into a slow drain of the archive.
2. Every later run walks each list newest-first again and stops as soon as it meets two consecutive pages of 2,000 rows it already knows (or rows far below its id watermark). A process it has never seen is `NEW_LISTING`; a known process found in a different list is `STATUS_CHANGE` (`previousEstado` says where it was). The AP and ET lists are small enough to be walked to the end every run (one or two requests each), so a process that **vanished** from them is probed on its detail page: if it now reads _En Trámite_ or _Concluida_ it is delivered as `STATUS_CHANGE` even when you do not monitor the CO list.
3. Amendments are invisible in the listing (no date moves when a circular or an acta is added - verified live), so with `fetchDetail: true` the Actor **re-reads the detail page of every known process whose opening is within `recheckWindowDays` or in the future**, compares the fingerprint, and delivers only real changes as `UPDATED`. Re-reads are not charged; a quiet day costs a few listing requests, a few hundred uncharged detail reads and the start fee.
4. Memory is written **only for records that were actually stored** - and records are delivered oldest-first - so a spending limit, a timeout or a platform migration half-way never loses a process: the next run simply picks it up. If a later run hits `maxItems` before its walk is complete, the Actor remembers how deep it got and the next run continues below the block it already delivered instead of stopping at it. The memory holds the whole register (50,000 entries).
5. Different filter sets get different memories automatically; set `deltaStateName` to share one deliberately, `resetState: true` to start over.

Why _newest created_ and not _opening date_? Because a tender published today can open in six weeks: ordered by opening date it sits at the end of the list on the day it appears; ordered by `idGestion` it is on top.

## Scheduling and alerts: Slack, email, Make, Zapier, n8n, Google Sheets

- **Apify Schedule + webhook** - schedule the task, add a webhook on `ACTOR.RUN.SUCCEEDED` pointing at your endpoint; the payload links the dataset and every item already carries the envelope, so no parser is needed. Read the items newest-first with `?desc=true`.
- **Slack** - the native [Apify Slack integration](https://apify.com/integrations/slack) posts each run's results to a channel.
- **Make** - _Apify > Watch Actor Runs_ -> _Get Dataset Items_ -> Slack / Gmail / Google Sheets ([apify.com/integrations/make](https://apify.com/integrations/make)).
- **Zapier** - _Apify: Finished Actor Run_ -> _Get Dataset Items_ -> anything ([apify.com/integrations/zapier](https://apify.com/integrations/zapier)).
- **n8n** - the Apify node, same pattern.
- **Google Sheets** - the [Apify Google Sheets integration](https://apify.com/integrations/google-sheets), or `=IMPORTDATA("https://api.apify.com/v2/datasets/<datasetId>/items?format=csv&desc=true&token=<token>")` (the token is then visible in the sheet - use a read-only token).

## Use it from code

**Node.js**

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_TOKEN' });
const run = await client.actor('stefano_seggio/santafe-compras-monitor').call({
    estados: ['AP', 'ET'],
    rubro: 'medicinales',
    onlyNew: true,
    maxItems: 300,
});
const { items } = await client.dataset(run.defaultDatasetId).listItems({ desc: true });
for (const t of items) {
    console.log(t.event_type, t.comprador, t.objeto, t.submissionDeadline, t.montoOriginalAmount, t.source_url);
}
```

**Python**

```python
from apify_client import ApifyClient

client = ApifyClient("YOUR_TOKEN")
run = client.actor("stefano_seggio/santafe-compras-monitor").call(
    run_input={"estados": ["CO"], "comprador": "Administración Provincial de Impuestos", "maxItems": 1000}
)
for t in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(t["numeroAnio"], t["objeto"], t["montoOriginalAmount"], t["montoOriginalCurrency"], t["hasAdjudicacion"])
```

**cURL (synchronous, up to 300 s - fine for delta runs and small pulls)**

```bash
curl -X POST "https://api.apify.com/v2/acts/stefano_seggio~santafe-compras-monitor/run-sync-get-dataset-items?token=YOUR_TOKEN&desc=true" \
  -H "Content-Type: application/json" \
  -d '{"estados": ["AP", "ET"], "onlyNew": true, "maxItems": 500}'
```

For large backfills start the run asynchronously (`/runs`) and read the dataset when the webhook fires.

**Apify CLI**

```bash
apify call stefano_seggio/santafe-compras-monitor --input '{"estados":["AP"],"objeto":"limpieza","maxItems":200}' --output-dataset
```

**AI agents (MCP)** - add `https://mcp.apify.com/?tools=stefano_seggio/santafe-compras-monitor` as an MCP server and ask: _"List the Santa Fe hospital tenders for medicines that open in the next two weeks, with budget and deadline."_

## How much does it cost to scrape Santa Fe tenders?

Pay per event, platform usage included - you pay only for records, never for compute:

| Event            | Price                 | When                                                                                            |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| `result`         | **$0.003** per record | A record with the full detail page (84 fields, document links, fingerprint)                     |
| `result-summary` | **$0.001** per record | Listing-only record (`fetchDetail: false`, or a process page the site reports as not published) |
| Actor start      | $0.00005              | Once per run                                                                                    |

Worked examples: a daily monitor of AP + ET that finds 8 new tenders and 4 amendments costs about **$0.04/day** (about $1/month); a 500-record filtered pull with detail **$1.50**; the whole 31,000-process archive **$93** with detail or **$31** listing-only. A quiet monitoring run with nothing new costs the start fee only. The Apify free plan's monthly credit covers well over a thousand detailed records.

Compare: Argentine tender-alert subscriptions (licit.ar, Licita Ya, Licigal) cost ARS 70,000-250,000 per month (roughly USD 50-180) for human-facing alerts without structured data, amounts, document-level change detection or an API.

## This Actor vs. the alternatives

|                      | This Actor                                                                                                | The register's own site                           | Its CSV export                                     | National tender aggregators / alert services              |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Coverage             | Every process, every estado, all years since 2000                                                         | Same, current year by default, 10 rows per screen | One filter set at a time, no ids, amounts or links | Santa Fe is one of hundreds of sources; depth varies      |
| Export               | JSON, CSV, Excel, API, webhooks                                                                           | Screen only                                       | Pipe-delimited text                                | Usually e-mail / WhatsApp alerts, API on enterprise plans |
| New-tender alerts    | Delta mode + schedule + Slack/webhook                                                                     | None (no RSS, no e-mail)                          | None                                               | Yes, human-facing                                         |
| Status changes       | `STATUS_CHANGE` with the previous estado                                                                  | Visible only by re-searching each list            | No                                                 | Rarely                                                    |
| Amendments           | `UPDATED` from a detail-page fingerprint (circulares, actas, preadjudicación, new dates)                  | Invisible in the listing                          | No                                                 | Rarely                                                    |
| Fields               | 84 incl. budget with currency, deadline, contact, expediente link, classified documents, UTC instants     | 9 listing columns + the detail page               | 9 columns                                          | Summary fields                                            |
| Filters              | estado, year, subject, type, modality, buyer, requesting body, rubro / sub-rubro, numbers, opening window | Same form, by hand                                | Same form                                          | Keyword-based                                             |
| Time for 500 records | About a minute                                                                                            | Hours                                             | Minutes + manual cleanup                           | n/a                                                       |

## Where the data comes from, legality and attribution

The Actor reads the public, logged-out Gestiones de Compra portal of the Government of the Province of Santa Fe, using the same read-only JSON endpoint the site's own search page calls (`AppAjax.php?a=consultas.getContrataciones`) and the public detail pages. It bypasses no login, CAPTCHA or access control; the site sets no crawl rules (`robots.txt` returns 404 on both `santafe.gov.ar` and `santafe.gob.ar`, checked 2026-09-08); its Términos y Condiciones regulate users' personal data under Ley 25.326 and contain no clause on automated access or reuse; the portal footer licenses its content under [Creative Commons Attribution-ShareAlike 2.5 Argentina](https://creativecommons.org/licenses/by-sa/2.5/ar/), so every record carries a `data_source` attribution string. Tender notices are public information by law (Ley 12.510 and the province's access-to-information regime). The Actor paces requests politely (at most 10 in parallel, verified harmless), never requests the `&contar=1` variant that inflates the site's view counter, and links to pliegos and actas instead of mirroring them. Contact fields hold institutional procurement-office data as published; the Actor does not enrich or cross-reference individuals. This Actor is not affiliated with or endorsed by the Government of Santa Fe.

## Honest limits

- The listing exposes **no publication or modification timestamp**; `publishedAt` comes from the detail page (one request per record) and amendment detection needs the detail page to be re-read (`recheckWindowDays`, bounded by opening date). A circular on a process that opened more than `recheckWindowDays` ago is not detected.
- `UPDATED` tells you a known process changed (the fingerprint covers estado, dates, places, budget, expedientes, notes and the document list), not which field changed.
- Status changes into the CO list of very old processes (created more than ~4,000 CO rows ago, roughly 1.5 years) are only caught by the status sweep, which needs the process to have been in your AP/ET memory.
- `openingFrom` / `openingTo` are client-side; the site has no date filter. Rows outside the window are skipped, not remembered, so they surface when they enter the window.
- `estado` on a record is the list it was read from; the detail page's own label is in `estadoLabel` / `estadoFromDetail` (they can differ for a few minutes around a transition).
- `montoOriginalAmount` is the published _Monto Original_ (initial budget), in ARS or USD as printed - never converted or inflation-adjusted. Awarded amounts are inside the linked documents, not in the page data.
- `sortBy: openingSoonest` on the CO list starts with a handful of ancient rows whose opening date is the epoch placeholder `1969-12-31`.
- Site markup changes can break extraction; the Actor validates every listing response and fails loudly (never "0 results, success").

## FAQ

### Is there an API for Santa Fe public tenders?

Not a documented one. The portal's search page calls an internal JSON endpoint that this Actor uses read-only, adding filters by name, delta events, normalised fields and document links.

### How do I get alerts for new tenders in Santa Fe?

Run this Actor on a schedule with `onlyNew: true` and connect a webhook, Slack, Make or Zapier. Each run delivers only the processes that appeared, changed status or were amended since the previous run.

### Can I filter by hospital, ministry, rubro or type of procedure?

Yes - buyer and requesting body (by id or name), rubro / sub-rubro (by id or name), procedure type, modality, year, subject, process number and file number are all applied by the site itself.

### How far back does the data go?

The register holds processes since 2000 (about 31,000). Use `anio` to slice it, or `estados: ["CO"]` with a `maxItems` of a few thousand for an archive pull.

### How often is the register updated?

New processes are published on business days, typically several a day; circulares and actas land at any time before and after the opening. Running every 6-24 hours is plenty.

### What is the difference between NEW_LISTING, STATUS_CHANGE and UPDATED?

`NEW_LISTING` is a process you have never received. `STATUS_CHANGE` is a known process that moved from one list to another (`previousEstado` -> `estado`), i.e. it opened or concluded. `UPDATED` is a known open process whose detail page changed - a circular, an acta de apertura, a cuadro comparativo, a preadjudicación report, a new opening date.

### What does AP / ET / CO mean?

AP = _Para Apertura_ (published, offers not yet opened), ET = _En Trámite_ (opened, being evaluated), CO = _Concluida_ (finished - awarded, deserted or revoked; the portal does not distinguish, but `hasAdjudicacion` and `hasOrdenProvision` tell you an award was published).

### Can I export the data to CSV or Excel?

Yes - every run's dataset can be downloaded as JSON, CSV, Excel or XML from the Output tab or the API.

### Do I need a proxy?

No. The site is reachable from Apify's datacenter IPs without a User-Agent, cookie or JavaScript.

### What happens if the site changes?

The Actor validates every listing response and fails the run instead of silently returning nothing, so your schedule alerts you. Report anything odd in the Issues tab.

### Is scraping the Santa Fe procurement register legal?

The data is public procurement information published by law and licensed CC BY-SA 2.5 AR; there are no crawl restrictions or anti-scraping terms. See _Where the data comes from_ above.

## Resumen en español

Este Actor extrae y monitorea el registro oficial **Gestiones de Compra de la Provincia de Santa Fe** (santafe.gov.ar/gestionesdecompras): todas las licitaciones públicas y privadas, concursos, contrataciones directas, subastas y convenios marco de ministerios, hospitales, SAMCOs y organismos provinciales. Cada registro incluye organismo licitante y comitente, objeto, monto original (con moneda), fecha límite de presentación y de apertura, rubros, expediente con enlace al seguimiento, contacto, y los enlaces directos a pliegos, circulares, actas de apertura, cuadros comparativos, informes de preadjudicación, normas de adjudicación y órdenes de provisión. Los filtros (estado, año, objeto, tipo de gestión, modalidad, comprador, solicitante, rubro y subrubro, número de gestión y de expediente) se aplican en el propio servidor del sitio; comprador, solicitante y rubro aceptan el nombre además del id. Con `onlyNew: true` y un cronograma, cada corrida devuelve solo las gestiones nuevas (`NEW_LISTING`), las que cambiaron de estado (`STATUS_CHANGE`, por ejemplo de Para Apertura a En Trámite) y las modificadas (`UPDATED`: circular aclaratoria, acta, preadjudicación, nueva fecha). Precio: US$ 0,003 por registro con detalle, US$ 0,001 por registro solo de listado; una corrida sin novedades cuesta solo el inicio. Los datos son públicos y están licenciados CC BY-SA 2.5 AR; el Actor no está afiliado al Gobierno de Santa Fe.

## Related Actors and roadmap

Same envelope, same delta engine, other registers by the same developer: [Córdoba Compras Monitor](https://apify.com/stefano_seggio/cordoba-compras-monitor), [Mendoza](https://apify.com/stefano_seggio/mendoza-compras-monitor), [Tucumán](https://apify.com/stefano_seggio/tucuman-compras-monitor), [Entre Ríos](https://apify.com/stefano_seggio/entrerios-compras-monitor), [Salta](https://apify.com/stefano_seggio/salta-compras-monitor) and [Buenos Aires Province](https://apify.com/stefano_seggio/pba-tenders-monitor) procurement monitors, [GrantConnect Grant Awards](https://apify.com/stefano_seggio/australia-grantconnect-monitor), [UK HSE Enforcement Monitor](https://apify.com/stefano_seggio/uk-hse-enforcement-monitor), [Florida Tenders Monitor](https://apify.com/stefano_seggio/florida-tenders-monitor).

Coming next for Santa Fe: field-level diffs for `UPDATED` events (which document was added), and an archive mode built on the site's CSV export for full-history pulls. Ask for features in the Issues tab.

## Support

Report problems or request fields in the **Issues** tab of this Actor - typical response within one business day. Versioned changes are listed in the Changelog tab.
