# Changelog

## 2.0.1 - 2026-09-08

### Fixed

- **Cold-baseline delta correctness**: the first delta run used to compare unseen rows against an `idGestion` threshold (`baselineFloor`) to decide what counts as history. `idGestion` is assigned at process creation, not at the moment a row enters a given estado list, so a process opened months ago can surface in ET or CO today carrying an id lower than everything already delivered - the threshold comparison could wrongly treat a genuinely new status change as history. The cold run now walks every selected list to completion (instead of stopping at `maxItems`), delivers only the newest `maxItems` rows, and records everything else it meets as baseline directly in the seen-set - a snapshot, not a numeric comparison that out-of-order ids can defeat. Cloud-verified: a cold run on the real register walked a 2,211-row ET list across 2 pages to the end, delivered the 100 newest, and a follow-up run 30 seconds later delivered 0 with 363 known open records re-checked for silent amendments (0 changed).
- Production `start` script pointed at `start:dev` (`tsx`), which Apify's production image cannot run (`npm install --only=prod` strips `tsx`); the run would have crashed on the platform despite working locally. Switched to the prebuilt `dist/main.js` and stopped gitignoring `dist/` so the build actually ships.
- `.actor/actor.json` description was 340 characters, over Apify's 300-character limit; trimmed to 297.

## 2.0.0 - 2026-09-08

The "institutional-grade" release: same envelope and field names, far more data, server-side filters, and a delta engine that finally sees status changes and amended documents.

### Added

- **Server-side filters** mirroring the register's own search form: `anio`, `objeto`, `tipoGestion` (13 site codes, several = one query each), `tipoModalidad`, `comprador` and `solicitante` (by site id or by name, resolved against the site's organism list at run start), `rubro` and `subrubro` (by id or name), `nroGestion`, `nroExpediente`. Version 1 pulled every row and filtered nothing; `anio` was wrongly documented as not working.
- **Newest-first walk** (`sort=idGestion&dir=DESC`, 2,000 rows per request, verified contiguous) with a real early-stop in delta mode, instead of walking a non-recency order up to `maxItems` every run - a new tender beyond the cap is no longer invisible forever.
- **`STATUS_CHANGE` events** (a known process moved AP -> ET -> CO, `previousEstado` says from where), detected in the listing and, for processes that vanished from the AP/ET lists, by probing their detail page.
- **`UPDATED` events**: known open processes (opening within `recheckWindowDays` or in the future) get their detail page re-read and fingerprinted, so a circular aclaratoria, an acta de apertura, a preadjudicación report or a new opening date is reported even though the listing never changes.
- **Opening-date window** `openingFrom` / `openingTo` (absolute or relative, forward with `+N days`), computed in Santa Fe time.
- **`eventTypes`**, `sortBy`, `deltaStateName`, `resetState`, `recheckWindowDays`, `maxConcurrency` inputs.
- **73 new output fields** next to the unchanged v1 ones: `publishedAt` (the only true publication timestamp, from the detail page), `submissionDeadline` and `openingAt` as UTC instants with day counts, `montoOriginalAmount` + `montoOriginalCurrency` (ARS / USD), `valorPliegoAmount` / `valorPliegoIsFree`, `estadoLabel` / `estadoStage` / `estadoFromDetail`, `expediente` + `expedienteUrl` (the listing's field is usually blank), `isElectronic` + `bidUrl`, `contactInfo` / `contactEmails` / `contactPhones`, `organismoComitente[]`, `organismoLicitante`, `rubros[]` split into rubro / sub-rubro, `documents[]` with a normalised `kind` and `has*` flags (pliego, circular, acta, cuadro comparativo, preadjudicación, adjudicación, orden de provisión), `printPdfUrl`, `documentsUrl`, `notes[]`, `destinos`, `objetoCompleto`, `tipoModalidad`, `numeroAnio`, `tipoGestionCode`, `contentHash`, `detailFetched` / `detailError`, `data_source`.
- **Concurrency** for detail pages (default 5, max 10): a 500-record run drops from ~3 minutes to under one.
- **Run summary** in the key-value store (`OUTPUT`): records by event type and estado, re-check and sweep counts, totals per estado on the register, pages walked, stop reason, delta store name.
- Five dataset views (Overview, Deadlines & openings, Documents & awards, Buyers & contacts, Status changes & amendments) and CSV / Excel / newest-first output links.
- Cheaper `result-summary` price for listing-only records (`fetchDetail: false`, or a process page the site reports as not published).
- Apache-2.0 licence, CI lint step, live test suite (`npm run test:live`).

### Fixed

- **Silent data loss in delta mode**: the seen-set used to be persisted _before_ records were pushed, so a spending limit, timeout or migration mid-run marked undelivered processes as seen forever. State is now written only for records actually stored, records are delivered oldest-first so any gap sits where the next walk starts, and the state is also flushed on platform `migrating` / `aborting` events.
- A listing response that was not JSON (maintenance page) used to crash the run without a summary, or `success:false` was reported as "no more results". Every response is now validated and the run fails loudly.
- Fetches now time out (45 s listing, 30 s detail), only network/408/425/429/5xx are retried, and an unpublished process page (HTTP 200 "no existe") is no longer delivered as a full-priced record with empty detail.
- Detail pages are fetched concurrently instead of one by one.
- `maxItems` default disagreed between code (200) and schema (100); it is 100 everywhere.
- The legacy `dateRange` parsed Santa Fe wall-clock as UTC; dates are now converted with the correct fixed UTC-3 offset.
- Cumulative `maxItems` across estados no longer stamps unwalked estados as checked.
- The delta memory grew from 3,000 ids per estado to 50,000 fingerprinted entries (the whole register).
- Log messages are in English.

### Changed

- `dateRange` is deprecated (still honoured, as a symmetric opening window) in favour of `openingFrom` / `openingTo`.
- Records are appended oldest-first within a run; use `?desc=true` on the dataset API (the views already do) to read newest-first.
- The delta memory lives in a per-filter-set named store (`santafe-compras-monitor-state-<name>`); the v1 store is not inherited, so the first v2 delta run sets a fresh baseline.

## 1.0.2 - 2026-09-06

- Delta engine (`onlyNew`, `dateRange`) and the standardised `record_id` / `event_type` / `scraped_at` / `is_new` / `source_url` envelope.

## 1.0.0 - 2026-09-04

- Initial release: JSON listing per estado, detail page extraction (fields, rubros, documentos), `result` charge per record.
