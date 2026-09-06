# AGENTS.md - Santa Fe Compras Monitor

Technical notes for whoever (human or AI) touches this actor next.

## What this actor does

Extracts public tenders (licitaciones, contrataciones) from the Province
of Santa Fe, Argentina's official procurement system, with full detail per
process - description, rubros, organism, and direct document links
(pliego, resolucion, acta de apertura, etc).

## Architecture

The simplest of this portfolio's actors so far, for a real reason: the
site's own search page (`gestionesdecompras/site/index.php`) drives a
read-only JSON API (`AppAjax.php?a=consultas.getContrataciones`) via plain
query-string GET requests - no ViewState, no postback, no session state,
no proxy needed (verified live: reachable from a plain datacenter IP).

- `src/fetchListing.ts` - pages through the JSON API per `estado` code
  (`AP`=Apertura Proxima, `ET`=En Tramite, `CO`=Concluido - verified live
  against the response's own `extraData.{ap,et,co}Total` breakdown).
  `anio` was tested as a filter parameter and doesn't appear to change
  results in any observable way, so it's deliberately omitted rather than
  implying a filter that doesn't work.
- `src/fetchDetail.ts` + `src/parsers/detail.ts` - fetches and parses each
  process's detail page (plain server-rendered HTML, no JS). The page is a
  flat sequence of `<div class="col-12 mb-4">` blocks: most are
  `<b>Label:</b><span>Value</span>` pairs, a few (Rubros / Subrubros,
  Organismo comitente) use one or more bare `<div>` for potentially
  multiple values, and a distinct block holds `<h4>Documentos</h4>` +
  `<h5>Tipo</h5>` headers each followed by `<div><a></a></div>` document
  links. `parseDetail` handles all three shapes.
- `src/http.ts` - shared fetch-with-retry helper, native `fetch()`, no
  proxy, exponential backoff for transient failures only.
- `src/main.ts` - for each selected `estado`, lists then (optionally, on
  by default) fetches full detail per process, pushes + charges per item.
- `src/state.ts` - the delta-engine's named key-value store (see below).
- `src/dateFilter.ts` - `dateRange` parsing/window logic (see below).

## Delta engine (2026-09-06 retrofit)

Added `onlyNew`/`dateRange` input + a standardized B2B output envelope
(`record_id`, `event_type`, `scraped_at`, `is_new`, `source_url`) across
this portfolio's fleet, matching the shape shipped on the UK HSE
Enforcement Monitor actor. Santa Fe-specific implementation notes:

### Why safe post-filter, not early-stop pagination

This is the one place this actor's implementation genuinely diverges from
HSE's, and it's backed by a live check, not a guess. Before writing
`onlyNew`, I queried the real endpoint directly (`curl`, no proxy, same as
`src/http.ts`) for each `estado` and inspected both the id and date fields
across consecutive pages:

- **`estado=AP`** is sorted **strictly ascending by `fechaHoraAperturaFija`**
  (the soonest upcoming bid opening first) - e.g. the first page returned
  opens 2026-09-07 09:00, 09:00, 09:30, 10:00, 10:00, ... in that exact
  order, with `idGestion` jumping around non-monotonically (138991, 138904,
  138761, 138971, ...). This is a real, useful domain sort ("what's opening
  soonest"), but it is the **opposite** of "newest published first": a
  brand-new AP record with an opening date three weeks out lands near the
  END of the list, not the front. An early-stop guard watching for "N
  consecutive pages of already-seen ids" would falsely declare "nothing
  new" the moment it walked past a run of near-term opening dates it
  already knew about, even with a genuinely new far-dated record sitting
  deeper in the list.
- **`estado=ET`/`CO`** show **no correlation at all** between list position
  and either `idGestion` or any date field. Sample from a live `ET` query:
  positions 1-5 were ids `138676, 137769, 138578, 138248, 138584` with
  opening dates `2026-08-31, 2026-05-29, 2026-08-11, 2026-07-21,
2026-08-25` - both columns jump in both directions with no pattern.
  Repeating the identical request ~2 seconds later returned the identical
  order (so it's _stable_ within a session - pagination doesn't skip or
  duplicate), but nothing about it says "recent things are near the
  front". This reads like an un-ordered (no explicit `ORDER BY`) query
  whose apparent stability comes from the database's own execution plan,
  not a documented contract - exactly the kind of thing the spec says not
  to build early-stop on without solid evidence, and there is none here.

Given that, `onlyNew` in `src/fetchListing.ts` is a **safe post-filter**:
the pagination walk is byte-for-byte the same loop that existed before
this retrofit (same `PAGE_SIZE`, same `maxItems` break conditions, same
per-`estado` cumulative budget) - `onlyNew`/`dateRange` are applied in a
second pass over the fully-walked `rawEntries`, never by skipping a page.
This costs the same number of requests as a same-size non-delta run
(no fast path), but it cannot silently miss a new record based on a false
assumption about ordering. Verified against the real fixture in
`test/fetchListingDelta.test.ts`: even when every id on a page is already
seen, `fetchWithRetryMock` is still called for that page (not skipped).

### record_id / event_type choices

- `record_id` = `idGestion` as a string, reused as-is (it already is a
  string in the API response) - no hashing, matching the spec.
- `event_type` is **always `'NEW_LISTING'`**, never a more specific value.
  I checked whether `CO` (Concluido) could defensibly map to something
  like HSE's `'SANCTION'` (an outcome/award signal), since the README
  already glossed `CO` as "concluded/awarded". Live check: fetched a real
  `CO` detail page's field list (`idGestion=126068` and two others) - there
  is **no awardee/adjudicatario field at all**, and the page's own
  `Estado` label reads a flat `"CONCLUIDA"` for every concluded record
  regardless of whether it was actually awarded, deserted (no bids), or
  revoked. Unlike a conviction record (which unambiguously IS an imposed
  sanction), a `CO` record here does not unambiguously mean "awarded" -
  labeling it that way would be a guess dressed up as a signal. So every
  record gets `'NEW_LISTING'`, and this is disclosed as a known limitation
  rather than silently picking something more specific-sounding.
- `source_url` reuses the existing `detailUrl` value verbatim (just
  renamed into the standardized field, per the spec's "replace, don't
  duplicate" instruction) - `detailUrl` itself is removed from the type
  and output.
- `scraped_at` **replaces** `scrapedAt`, with one real behavior fix beyond
  the rename: the old code called `new Date().toISOString()` **inside the
  per-record push loop**, so records from the same run could get
  microseconds-apart-but-different timestamps depending on how long detail
  fetches took. `scraped_at` is now computed once in `main.ts` before the
  loop and reused for every record, matching the spec's "same value for
  every record from one run" and this portfolio's own HSE precedent.

### State persistence

`src/state.ts` opens a **named** key-value store
(`santafe-compras-monitor-delta-state`) rather than the run's default one -
Apify's default KV store is isolated per run and would not survive between
scheduled runs, which defeats the whole point of a delta. State is keyed
per **`estado`** (`AP`/`ET`/`CO`), not flattened into one global id list:
the same `idGestion` legitimately moves through `AP` -> `ET` -> `CO` over
its real lifecycle (a tender opens, then is "in progress", then
concludes), and each transition is a genuinely new appearance in that
estado's own list worth re-flagging as `is_new` there - the same reasoning
HSE applied to keep convictions/notices id spaces independent. Each
estado's seen-id list is capped at 3000 entries; since this source's order
isn't a recency signal (see above), the cap keeps "this run's walked ids
first" as a best-effort retention rule, not a guaranteed "keep the
newest" one - a real, disclosed difference from HSE's cap (which can
honestly claim "newest ids first" because its source is verified
newest-first).

### dateRange

`fechaHoraApertura`/`fechaHoraAperturaFija` (the bid opening date, present
on every listing item regardless of `fetchDetail`) is the natural date
field used for `dateRange`, via `src/dateFilter.ts`'s `parseSantaFeDate`
(format `"YYYY-MM-DD HH:mm:ss"`, verified against real API responses).
Two real gotchas here, both different from HSE's date handling:

1. **It's a future date for `AP`, not a past one.** HSE's Offence/served
   dates are always historical, so `now - date <= window` ("happened in
   the last N") is the right check. Santa Fe's opening date can be weeks
   in the _future_ for `AP` - a one-directional past-only check would make
   every single `AP` record trivially pass every `dateRange` preset (a
   negative difference is always <= a positive window), which is a
   silently-meaningless filter for exactly this actor's default `estado`.
   Fixed by checking `Math.abs(now - date) <= window` instead - see
   `isWithinDateRange` and the "also matches a FUTURE date" test in
   `test/dateFilter.test.ts`.
2. **Timezone simplification, disclosed.** `fechaHoraAperturaFija` is
   Argentina local time (fixed UTC-3, no DST since 2009) but is parsed as
   if it were UTC, same pragmatic shortcut HSE's `parseUkDate` makes for
   BST - off by a constant few hours, negligible at 24h/7d/30d
   granularity, not worth a timezone library for this.
3. **This is a scheduling date, not a "when was this published" date** -
   for `AP` it answers "opening in the next Nh/d", and for `ET`/`CO` it's
   the historical opening date of a process whose _state_ may have only
   just changed. `onlyNew` remains the reliable "what's new" signal;
   `dateRange` is for users who specifically want opening-date semantics.
   Disclosed in the README, not silently misleading (same posture as
   HSE's Offence Date lag disclosure).

### A real gotcha hit while doing this

Running `apify run --no-purge` locally against the real site to smoke-test
the whole loop (cold run, then a second `onlyNew: true` run against the
state the first run wrote) worked correctly end to end - `Cargados 3 items
al dataset` on the cold run, then `Total gestiones listadas: 2
(onlyNew=true...)` on the second run against the real live listing, with
`storage/key_value_stores/santafe-compras-monitor-delta-state/state.json`
correctly accumulating all 5 ids. The actual gotcha: on this Windows/Node
24 setup, the `apify run` CLI process crashes on exit _after_ the actor
has already finished and logged `Cargados N items al dataset.`
(`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) ... src\win\async.c`)

- a libuv/Node-on-Windows shutdown issue in the CLI's process wrapper, not
  in this actor's code. Don't mistake the crash banner for a real failure -
  check the last log line before it (`Cargados ... al dataset.` /
  `Total gestiones listadas: ...`) to see if the run actually succeeded.
- **Local testing note**: same as HSE, `apify run` purges local storage by
  default even without `--purge` explicitly - use `--no-purge` to test
  delta behavior across two separate local runs.

## Known scope limits (disclosed, not hidden)

- `anio` (year) is not exposed as an input filter - tested live and it
  doesn't appear to change the API's response, so exposing it would imply
  a filter that doesn't actually work.
- `fetchDetail: true` (default) adds one extra HTTP request per process.
  For a `maxItems` covering the full `ET`/`CO` backlog (1000+ each), this
  is a real cost/time multiplier - `fetchDetail: false` gives a
  listing-only fast path when the extra detail isn't needed.
- `onlyNew` is a safe post-filter, not an early-stop optimization - a
  delta run costs the same requests as a same-size non-delta run. See the
  "Delta engine" section above for the live evidence this was based on.
- `event_type` is always `NEW_LISTING` - see "record_id / event_type
  choices" above for why `CO` doesn't get a more specific value.
- `.prettierignore` now excludes `test/fixtures` (matching the UK HSE
  actor's own `.prettierignore`), because `test/fixtures/detail_138825.html`
  has a genuinely malformed closing `</main>` tag that crashes prettier's
  HTML parser - pre-existing, unrelated to this retrofit, confirmed present
  on the original commit before the delta engine work started (verified
  via `git stash` + `format:check` against the base commit). Also
  pre-existing and left alone: `package.json`/`package-lock.json` were
  never run through this repo's own `prettier --write .` before their
  initial commit (they're still npm's default 2-space indent, not this
  repo's configured 4-space) - `npm run format:check` reports both as
  needing reformatting. Fixing that is a repo-wide, purely-cosmetic
  whitespace rewrite unrelated to the delta engine, so it was deliberately
  left out of this retrofit's diff rather than bundled in.

## Sibling candidates (from the same parallel audit that found this target)

Tucuman, Entre Rios and Salta all came back `viable` from the same
6-province live audit that found this target (2026-09-04) - plain
HTML/PHP, zero DevExpress/AJAX markers. Mendoza also viable but more
fragile (runs COMPR.AR; the results grid itself is a plain GridView
reachable via POST, but its own pagination mechanism was not confirmed
live before this was written - do that first). Neuquen was rejected:
GeneXus AJAX+WebSocket tied to session state, not reproducible with plain
fetch/cheerio. Full audit notes in that session's workflow journal, not
copied into any repo - re-verify live before building the next one rather
than trusting old notes, since these sites can and do change.
