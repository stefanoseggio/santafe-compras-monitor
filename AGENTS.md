# AGENTS.md - Santa Fe Tenders Scraper & Monitor

Technical notes for whoever (human or AI) touches this actor next. Everything
below was verified live against santafe.gov.ar on 2026-09-08 unless stated.

## What this actor does

Extracts the Province of Santa Fe's **Gestiones de Compra** procurement
register - listing rows from the site's own read-only JSON endpoint plus one
server-rendered detail page per process - with the site's search filters
applied server-side, and a delta engine keyed on `idGestion` (identity and
ordering) plus a per-record fingerprint of the detail page (change
detection), so new processes, estado transitions and amended documents are
all reported.

## Site facts that shape the design

### Access

- No User-Agent, cookie, proxy or JS needed (a bare request with an empty
  UA gets HTTP 200). A browser UA is sent anyway. Apache with HSTS/CSP only,
  no WAF. `robots.txt` -> 404 on `www.santafe.gov.ar` and `www.santafe.gob.ar`.
- Rate tolerance: 10 concurrent detail GETs -> 10/10 200 in ~0.1-0.3 s each;
  `maxConcurrency` is capped at 10, default 5. Never request
  `gestion.php?...&contar=1` (the site's own buttons add it; it increments a
  view counter).

### Listing: `site/AppAjax.php?a=consultas.getContrataciones`

Response `{success, errors:{reason}, data:[...], type, totalRecords:"N",
extraData:{apTotal, etTotal, coTotal}}`. `totalRecords` = rows in THIS
estado; `extraData` = counts for all three estados under the current filter
set (both exposed in the run summary). Past the end -> `success:true,
data:[]`. Omitting `estado` returns everything (31,214) with extraData
zeros; an invalid estado silently falls back to AP - the actor always sends
one of AP/ET/CO. Invalid `sort` -> HTTP 500 with an EMPTY body (retried as
5xx, then the run fails - correct for a site change).

Row keys: `idGestion, tipoGestion, fechaHoraApertura (DD-MM-YYYY),
numeroAño, numeroGestion, anioGestion, valorPliego (free text), objeto,
objetoCompleto, idOrganismoGestion, comprador, tipoModalidad,
numeroExpediente (often blank), fechaHoraAperturaFija (YYYY-MM-DD HH:mm:ss,
Santa Fe time)` + `destinos` on ET/CO rows only. The listing has NO
publication or last-modified field.

Server-side parameters (all live-verified with counts; totals AP 78 /
ET 2,214 / CO 28,921 that day):

| param             | example                     | notes                                                                                                                                                                                  |
| ----------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `estado`          | `AP` / `ET` / `CO`          | one per query                                                                                                                                                                          |
| `anio`            | `2025`                      | AP 0 / ET 708 / CO 2,631. The site's UI always sends the current year; the actor sends it only when set                                                                                |
| `objeto`          | `limpieza`                  | case-insensitive phrase; word order matters (`limpieza servicio` -> 1)                                                                                                                 |
| `tipoGestion`     | `L`                         | ONE letter code; `L,P` is ignored (returns all) -> the actor runs one query per selected code. Lower-case `l` is ignored too -> upper-cased in input.ts                                |
| `tipoModalidad`   | `2`                         | Convenio Marco: CO 117 / ET 4                                                                                                                                                          |
| `comprador`       | `27`                        | idOrganismoLey12510 from `shared.getOrganismosLey` (211 entries); NOT the row's `idOrganismoGestion` (different id space: 449 vs 27 for the same body). A name -> 0 rows               |
| `solicitante`     | `27`                        | same id space (organismo comitente)                                                                                                                                                    |
| `idEspecie`       | `57`                        | rubro from `shared.getEspeciesPrincipales` (78 entries)                                                                                                                                |
| `idFamilia`       | `226` (with `idEspecie=57`) | sub-rubro. The site's own select is named `form-select` and does NOTHING (57+form-select=367 -> still 12); the backend honours `idFamilia` (57+226 -> 4, 57+367 -> 6). Needs idEspecie |
| `nroGestion`      | `02`                        | exact string match on numeroGestion                                                                                                                                                    |
| `nroExpediente`   | `EE-2026-00001797-APPSF-OD` | exact full match only                                                                                                                                                                  |
| `sort` + `dir`    | `idGestion` + `DESC`        | accepted: idGestion, fechaHoraApertura, tipoGestion, objeto, comprador, consultada. `fechaHoraApertura ASC` on CO starts with epoch rows (1969-12-31)                                  |
| `start` + `limit` | `0` + `2000`                | limit honoured up to at least 6,000 (2,000 rows 2.9 s / 1.3 MB; 5,000 rows 5.0 s / 3.2 MB)                                                                                             |

There is no date filter of any kind (`fechaDesde`/`fechaHasta` are ignored).

### Ordering: `idGestion DESC` is the only recency signal

Default (no sort) AP is ascending by opening date; ET/CO have no ORDER BY.
`sort=idGestion&dir=DESC` gives newest-created first and paginates
contiguously (page 1 138923..136861, page 2 136857..135432, strictly
descending, no overlap). `idGestion` is allocated at creation and only
approximately follows publication (139028 published after 139030; drafts
can be published days after their id was allocated), hence the 500-id
watermark margin and the 2-known-pages rule. A record's `idGestion` and
`Fecha de Publicación` NEVER change: 138676 gained a CIRCULAR ACLARATORIA
and 126068 gained an acta + preadjudicación with the original date and id.
So amendments are invisible in the listing - only the detail page tells.

### Detail: `site/gestion.php?idGestion=N`

Flat sequence of `<div class="col-12 mb-4">` blocks: `<b>Label:</b><span>`
for single values; `<div>` children for Rubros / Subrubros, Organismo
comitente and Expedientes (the code is wrapped in a link to
`expedientes-web/expediente-timbo/?...` for electronic files or
`index.php/apps/sie?...` for legacy ones); `<h4>Documentos</h4>` +
`<h5>Tipo</h5>` headers + `<div><a href="./../descargar.php?m=anexo&id=..&hash=..&panel=0" title>`.
Some buyers append free-form blocks with a malformed `<b> IMPORTANTE <b>
<span>` label (139031) - parsed into `notes[]`, never crash. Zero-width
spaces occur in pasted text and are stripped.

Labels seen in a 120-page sample (all pages): Fecha de Publicación,
Modalidad, Estado, Alcance, Objeto de la gestión, Rubros / Subrubros,
Organismo comitente, Organismo licitante, Fecha y hora de apertura de
ofertas, Valor del pliego, Monto Original; most pages: Lugar de
presentación de ofertas, Fecha y hora límite de presentación de ofertas,
Descripción, Lugar de apertura de ofertas, Lugar y fecha de entrega;
72/120 Expedientes; 14/120 Contacto para información. Labels are matched
accent- and case-insensitively (`fold()`).

- Estado label: `PARA APERTURA` | `EN TRÁMITE` | `CONCLUIDA`, sometimes with
  a stage suffix (`EN TRÁMITE - Análisis de ofertas - Control de
documentación`) -> `estadoStage`.
- `Fecha y hora de apertura de ofertas` is `DD-MM-YYYY HH:mm Hs. - <note>`;
  the note is usually empty, sometimes `(*** NUEVA FECHA ***)`.
- `Monto Original` is `$  207.302.040,00` (ARS) or `U$S 60.000,00` (USD -
  5/120). Thousands `.`, decimals `,`; old rows use `$  480.-` / `$  7.00`.
- Document `<h5>` vocabulary (120 pages): Pliego 94, Otros 49, Orden de
  Provisión 47, Cuadro Comparativo de Precios 43, Acta de Apertura 35,
  Informe de Preadjudicación 32, Norma Legal de Adjudicación 29, Llamado a
  Licitación 10, Circulares 4, Informe de Comisión 3, Documento de Provisión
  2, Nómina de Oferentes 1, Planimetría 1 -> `DocumentKind` in
  `parsers/detail.ts`. Document URLs are stable (id + hash); HEAD returns
  `Content-Disposition: attachment; filename="..."`, no Last-Modified.
- Nonexistent / unpublished id -> HTTP 200 with "La gestión no existe o no
  está publicada aún" and no blocks -> `exists:false` -> `UNPUBLISHED`.
- Print PDF: `site/output.php?a=gestiones.ver&idGestion=N&print=1`; docs-only
  view `gestion.php?idGestion=N&solodocs=1`; electronic bids:
  `https://gestionvirtual.santafe.gob.ar/#/bandeja_proveedores/create/form/680a87a12a055d2295ea39a0?expedienteCode=<numeroExpediente>`
  when the expediente matches `/^[A-Za-z]{1,6}-\d{1,4}-\d{1,8}-APPSF-[A-Za-z]{1,2}(#[A-Za-z]{1,6})*/`
  (the site's own `puedeOfertar` rule, copied from its index.js).

### Timezone

Argentina: fixed UTC-3, no DST since 2009. `normalize.ts` uses a constant
offset (no Intl). Site timestamps were consistent with UTC-3 live.

## Architecture

- `src/input.ts` - validates and resolves the input into `ListingFilters` +
  `queries` (one per estado x tipoGestion) + `RunOptions`; resolves organism
  / rubro / sub-rubro names through `src/lookups.ts` (the site's combo
  endpoints, injected for tests); computes the filter fingerprint that names
  the delta store; handles relative dates (`7 days` back, `+7 days` forward)
  and the legacy `dateRange`.
- `src/urls.ts` - `listingPath()`, detail / print / docs / bid URLs, the
  tipoGestion and modalidad code tables.
- `src/http.ts` - `fetch` with timeout, retry policy (network/408/425/429/5xx
  only), `fetchOptional` (404 -> null), `mapWithConcurrency`.
- `src/parsers/listing.ts` - `parseListingResponse()`: JSON shape validation
  (success + data[] + extraData + numeric idGestion per row) -> rows, totals,
  is-it-a-listing-at-all. `src/parsers/detail.ts` - `parseDetailPage()`
  (structured) and `parseDetail()` (v1 `detail` object).
- `src/fetchGestiones.ts` - `walkListing()` (pagination + classification +
  stop rules + recheck selection, no detail fetches), `enrichBatch()`
  (detail fetches with bounded concurrency), `buildRecord()` (all
  normalisation), `fingerprintOf()` (change key).
- `src/state.ts` - named-store delta state v2 (`seen: {idGestion:
"ESTADO|hash"}`, numeric `watermark`, `backlogFloor`, `baselineFloor`,
  `filtersSignature`), prune lowest ids first at 50k.
- `src/main.ts` - orchestration: walk -> deliver candidates oldest-first ->
  re-check known open records -> status sweep of vanished open records ->
  persist -> summary. Never pushes anything but records; fails the run on
  error (`Actor.fail`), so alerts fire.

## HTTP transport: `impit`, not the native `fetch`

`src/http.ts`'s `fetchWithRetry` calls a module-level `Impit` instance
(`new Impit({ browser: 'chrome' })`, from the `impit` package) instead of
the global `fetch` - added 2026-09-19 as a fleet-wide TLS-fingerprint-
hardening pilot (proactive hardening, not a bug fix - Node's `fetch` isn't
deprecated). santafe.gov.ar itself needs no User-Agent, cookie, proxy or JS
today (see Access above) and has no WAF, so this doesn't fix anything
currently broken here; it closes the gap between the Chrome UA `http.ts`
already sends and Node's own (distinctively bot-shaped) TLS fingerprint,
in case the site ever grows header- or fingerprint-based bot detection the
way GrantConnect did. No test-mocking changes were needed for this actor:
its test suite mocks `fetchWithRetry`/`fetchOptional` directly
(`vi.mock('../src/http.js', ...)` in `walkListing.test.ts`,
`main.delivery.test.ts` and `main.recheck.test.ts`), not the global
`fetch`, so it was unaffected by the transport swap underneath.

## Delta engine invariants (do not break these)

1. **State is written only for delivered records** (`markSeen` after a
   successful `pushData`, with the estado list and the detail fingerprint),
   plus, at the END of a successful run, for rows walked but intentionally
   excluded as `baseline` or `eventType`. Rows excluded by the opening
   window are NOT remembered (they must surface when they enter the
   window). `saveState` runs every 50 delivered records, in a `finally`, and
   on the platform `migrating` / `aborting` events.
2. **Delivery is oldest-first** (lowest idGestion first) within a run, so a
   crash leaves the NEWEST candidates undelivered - exactly the rows the
   next walk visits first. The dataset is an append-only chronological log;
   the views and README tell users to read it with `desc=true`.
3. **Walk**: one query per estado (x tipoGestion), `sort=idGestion&dir=DESC`,
   `limit=2000`; end of list = `start + rows >= totalRecords` or an empty
   page. In delta mode a page counts as "known" when it has no new /
   status-changed rows (baseline and window exclusions do not count as
   changes); 2 consecutive known pages stop the query, as does a page whose
   ids are all below `min(watermark, backlogFloor) - 500`. Full mode never
   stops early. Ids are de-duplicated across pages and queries.
4. **Classification**: unseen id -> `NEW_LISTING`; seen under another
   estado -> `STATUS_CHANGE`; seen under the same estado -> unchanged in the
   listing, and (delta + fetchDetail + UPDATED wanted + opening within
   `recheckWindowDays` or in the future) queued for a detail re-read. A
   re-read whose fingerprint differs from the stored one is delivered as
   `UPDATED`; a stored fingerprint of `""` (listing-only delivery, baseline
   exclusion) is filled in silently, never reported as an update. Re-reads
   are capped at 1,000 per run (newest first).
5. **Status sweep**: after delivery, for each of AP / ET that was selected
   AND walked to its end this run, every remembered id under that estado
   that was not met on any page is probed on its detail page (cap 300 per
   run): a different estado -> `STATUS_CHANGE` built from the detail page
   alone (`item: null`, listing-only fields null); "no existe" -> forgotten
   (it comes back as new if republished); same estado -> left alone.
   Requires fetchDetail and STATUS_CHANGE in eventTypes.
6. A COLD delta run (no seen entries, no lastRunAt) cut short by `maxItems`
   defines the **baseline**: `state.baselineFloor` = idGestion of the oldest
   row it delivered. On later runs an unseen row with id <= floor is
   excluded as `'baseline'` (history), does not count as a change for the
   early-stop, and is marked seen at the end (hash `""`) so a later status
   change or amendment can still surface. Only `resetState` clears it.
   A NON-cold run cut short by `maxItems` never marks the overflow as seen;
   it logs a warning AND records a **backlog floor** (`state.backlogFloor` =
   idGestion of the oldest row the truncated walk reached). While the floor
   is set, pages at or above it never count towards the early-stop and the
   watermark cutoff is moved below the floor, so the next run walks through
   the delivered block down to the rows it never reached. A walk that ends
   naturally clears the floor.
7. **Detail failures**: an `UNPUBLISHED` page (200 "no existe" or 404) is
   delivered as a summary record and marked seen with hash `""`; a transient
   failure (network / 5xx after retries) is NOT delivered and NOT marked
   seen (retried next run); if every detail page of a run fails while the
   listing worked, the run fails.
8. The delta store name defaults to `auto-<hash of filters>` (opening window,
   maxItems, fetchDetail, sortBy and recheckWindowDays excluded from the
   hash). The v1 store `santafe-compras-monitor-delta-state` is never
   adopted (it was written before delivery and regardless of filters).
9. Charging: records with a parsed detail page are pushed with event
   `result`, the rest with `result-summary`; `chargedCount` from the SDK is
   the number actually stored in PPE mode (outside PPE everything is stored,
   nothing charged). Re-reads and sweep probes are not charged unless they
   produce a record.

## Tests

- `npm test` - offline, ~1 s: live-captured fixtures (`test/fixtures`:
  AP/ET/CO listing pages sorted newest-first, six detail pages covering AP /
  ET with circular / CO with acta + preadjudicación / USD + notes / full
  award document set / staged estado, the nonexistent page) + mocked HTTP;
  two end-to-end runs of `src/main.ts` with the SDK mocked (delivery under
  a spending limit; re-check + status sweep).
- `npm run test:live` (`LIVE=1`) - six live checks against santafe.gov.ar
  (~3 s): newest AP with detail, anio + tipoGestion filters, organism by
  name, rubro + sub-rubro by name, zero-result termination, unpublished id.
- Local end-to-end: put an input in `storage/key_value_stores/default/INPUT.json`
  and `apify run --purge`; the delta store appears under
  `storage/key_value_stores/santafe-compras-monitor-state-<name>/`. Use
  `--no-purge` (or `apify run` without `--purge`) for the second, delta run
  so the named store survives. On this Windows/Node 24 setup the CLI may
  print a libuv assertion after the actor has already exited cleanly -
  check the actor's own last log line.

## Known scope limits (disclosed in the README)

- No publication / modification timestamp in the listing; amendment
  detection is bounded by `recheckWindowDays` on the opening date.
- Status changes of processes older than the CO delta walk depth (2-3 pages
  of 2,000) are only caught through the sweep of the AP/ET memory.
- `UPDATED` says the record changed, not WHAT changed (no field-level diff;
  would need snapshot storage).
- The bulk CSV export (`site/output.php?a=consultas.get_csv&estado=CO&limit=10000`,
  pipe-delimited, 9 columns, no idGestion) is not used - candidate for an
  archive mode.
