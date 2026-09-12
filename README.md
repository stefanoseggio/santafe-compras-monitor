# Santa Fe Government Tenders Monitor - Argentina Public Procurement (Licitaciones Santa Fe)

## Executive value proposition

The Province of Santa Fe, Argentina publishes every public procurement process on one official register, _Gestiones de Compra_ (santafe.gov.ar/gestionesdecompras) - but the portal has no RSS feed, no e-mail alerts and no documented API, and its search form defaults to the current year with a plain CSV export that carries no ids, amounts or document links. Tracking a rubro or a set of buyers today means re-opening the AP / ET / CO lists by hand, across dozens of ministries, hospitals and SAMCOs, and re-reading each process page to notice a circular or a moved opening date - work that does not scale past a handful of buyers. This Actor turns that register into structured JSON/CSV with buyer, budget, deadlines, rubros, expediente and direct PDF links to pliegos, circulares and actas, and its delta mode returns, on every scheduled run, only the tenders that are new, changed status, or were amended since the previous run - so a person checks one feed instead of the portal, one list at a time.

## Who uses this

- **Suppliers to the provincial health system** (pharma and medical-supply distributors, lab, cleaning and food vendors to hospitals and SAMCOs) filter by `rubro` (e.g. `medicinales`) and `estado: AP`, then watch `comprador`, `submissionDeadline`, `daysUntilDeadline` and `montoOriginalAmount` to decide bid or no-bid inside a short window and pull the pliego straight from `documents`.
- **Construction, IT, security and facility-service contractors to ministries** search by `objeto` or `comprador` across the AP and ET lists, check `montoOriginalAmount`, whether the process is `isElectronic` (and its `bidUrl` on gestionvirtual.santafe.gob.ar) to route the opportunity to the right sales owner.
- **Bid consultants and _gestores de licitaciones_** run the Actor in delta mode with `fetchDetail: true` on the tenders their clients already track, and watch for `event_type: "UPDATED"` together with `hasCircular` or a changed `openingNote` (e.g. `(*** NUEVA FECHA ***)`) to know a draft offer needs a second look before the deadline.

## Input

Every filter below is applied by the register's own search API server-side (except the two opening-date fields, which are client-side) so a narrow run is one request. Leave filters empty to walk the selected `estados` newest-first.

Daily monitor of every new, changed or amended open tender:

```json
{ "estados": ["AP", "ET"], "onlyNew": true, "maxItems": 500 }
```

Hospital medicines and medical supplies, monitored:

```json
{ "estados": ["AP"], "rubro": "medicinales", "onlyNew": true, "maxItems": 300 }
```

| Field                       | Type     | Default                    | Description                                                                                                                                                       |
| ---------------------------- | -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `estados`                    | string[] | `["AP"]`                    | Lists to read: `AP` Para Apertura (published, offers not yet opened - where every new tender appears first), `ET` En Trámite (opened, being evaluated), `CO` Concluida (finished). One server-side query per list.  |
| `anio`                        | integer  | -                            | Year of the process number (`anioGestion`). The site's own UI always applies the current year; empty = all years since 2000.                                       |
| `objeto`                      | string   | -                            | Case-insensitive phrase search over the tender subject, e.g. `limpieza`, `medicamentos`, `servicio de vigilancia`. Word order matters.                              |
| `tipoGestion`                 | string[] | `[]`                         | Procedure types by site code, one query per type: `L` Licitación Pública, `P` Licitación Privada, `A` Licitación Acelerada, `T` Contratación Directa, `B` Concurso Público, `V` Concurso Privado, `C` Concurso de Precios, `I` Concursos de Proyectos Integrales, `D` Gestión Directa, `S` Subasta o Remate Público, `X` Procedimiento Competitivo Ágil, `Y` Entes Portuarios, `O` Otros. |
| `tipoModalidad`               | string   | -                            | Contracting modality code: `1` Sin Modalidad, `2` Convenio Marco, `3` Contratación Unificada, `4` Orden de Compra Abierta, `5` Subasta Inversa, `6` Llave en Mano, `7` Consumo Convenio Marco, `9999` Por Defecto. |
| `comprador`                   | string   | -                            | The organism running the procedure (organismo licitante), as its site id (`idOrganismoLey12510`) or a distinctive part of its name (e.g. `Hospital Cullen`). Matched against the site's own organism list at run start. |
| `solicitante`                 | string   | -                            | The organism the purchase is for (organismo comitente), same id space and name matching as `comprador` (e.g. `Ministerio de Salud`).                               |
| `rubro`                       | string   | -                            | Product/service category, as the site's `idEspecie` or part of its name (e.g. `medicinales`, `limpieza`, `alimentos`). Matched against the site's 78 rubros at run start. |
| `subrubro`                    | string   | -                            | Sub-category within the selected rubro, as `idFamilia` or part of its name. Requires `rubro`.                                                                        |
| `nroGestion`                  | string   | -                            | Exact process number as printed on the site, e.g. `18` (combine with `anio`: several organisms share the same numbering).                                            |
| `nroExpediente`               | string   | -                            | Exact, full expediente number, e.g. `EE-2026-00001797-APPSF-OD` (partial values match nothing on the site).                                                          |
| `openingFrom`, `openingTo`    | string   | -                            | Bid-opening date window: absolute (`2026-09-01`) or relative (`7 days` back, `+7 days` forward). Client-side - the site has no date filter; rows outside the window are skipped, not remembered. |
| `eventTypes`                  | string[] | `NEW_LISTING`, `STATUS_CHANGE`, `UPDATED` | Which delta events to deliver (delta mode only).                                                                                            |
| `onlyNew`                     | boolean  | `false`                      | Delta mode - remembers every process delivered (per filter set) with its estado and a fingerprint of its detail page, and returns only new, status-changed or amended processes. See Reliability below. |
| `recheckWindowDays`           | integer  | `30`                         | Known processes opening within this many days in the past (or any time in the future) get their detail page re-read every run to detect amendments. `0` disables. |
| `sortBy`                      | string   | `newest`                     | `newest` (`idGestion` descending, required for delta mode), `openingSoonest`, `openingLatest`, `mostViewed` (full runs only).                                        |
| `deltaStateName`              | string   | fingerprint of the filters   | Label for the delta memory of a monitoring task; set the same name on two tasks to share one memory.                                                                 |
| `resetState`                  | boolean  | `false`                      | Forget every previously delivered process for this delta state and re-baseline.                                                                                      |
| `maxItems`                    | integer  | `100`                        | Hard cap on delivered records per run (max `100000`). In delta mode, anything beyond the cap is delivered by the next run.                                           |
| `fetchDetail`                 | boolean  | `true`                       | Open each process page for publication time, budget, deadline, places, rubros, requesting organism, contact, expediente and document links. Off = cheaper listing-only records, no `UPDATED` detection. |
| `maxConcurrency`              | integer  | `5`                          | Parallel detail-page requests (`1`-`10`).                                                                                                                             |

## Output

One real record (the `detail` compatibility object trimmed for length):

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

A status change carries `"event_type": "STATUS_CHANGE"`, `"previousEstado": "AP"`, `"estado": "ET"`; an amendment carries `"event_type": "UPDATED"`, `"is_new": false` and, typically, `"hasCircular": true` or a new `openingNote` such as `(*** NUEVA FECHA ***)`.

Every record carries all 84 fields, grouped as follows:

| Group                         | Fields                                                                                                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Integration envelope           | `record_id`, `event_type` (`NEW_LISTING` / `STATUS_CHANGE` / `UPDATED`), `scraped_at`, `is_new`, `source_url`, `data_source` (CC BY-SA 2.5 AR attribution)                                                                                                                       |
| Identity (v1) + detail (v1)    | `idGestion`, `estado`, `tipoGestion`, `numeroGestion`, `anioGestion`, `fechaHoraApertura`, `objeto`, `comprador`, `valorPliego`, `numeroExpediente`, `detail` (`fields`, `rubros`, `documentos` kept verbatim)                                                                    |
| Listing twins                  | `idGestionNumber`, `numeroAnio`, `tipoGestionCode`, `tipoModalidad`, `idOrganismoGestion`, `objetoCompleto`, `destinos`, `openingAt` / `openingDate` / `daysUntilOpening` / `isOpeningInFuture`, `valorPliegoAmount` / `valorPliegoCurrency` / `valorPliegoIsFree`, `previousEstado`, `isElectronic`, `bidUrl`, `printPdfUrl`, `documentsUrl` |
| Detail (`fetchDetail: true`)   | `estadoLabel` / `estadoStage` / `estadoFromDetail`, `publishedAtLocal` / `publishedAt` / `publishedDate` / `daysSincePublished`, `modalidad`, `alcance`, `descripcion`, `rubros[]` / `rubroNames` / `subrubroNames`, `organismoComitente[]`, `organismoLicitante`, `submissionPlace`, `submissionDeadlineLocal` / `submissionDeadline` / `daysUntilDeadline`, `openingPlace`, `openingNote`, `deliveryPlaceAndDate`, `notes[]` |
| Money                          | `montoOriginalText`, `montoOriginalAmount`, `montoOriginalCurrency` (`ARS` or `USD`, never converted)                                                                                                                                                                              |
| Files & contact                | `expedientes[]` (`label`, `code`, `url`), `expediente`, `expedienteUrl`, `contactInfo`, `contactEmails[]`, `contactPhones[]`                                                                                                                                                       |
| Documents                      | `documents[]` (`kind`, `tipo`, `nombre`, `url`, `id`), `documentCount`, `documentKinds[]`, `hasPliego`, `hasCircular`, `hasActaApertura`, `hasCuadroComparativo`, `hasPreadjudicacion`, `hasAdjudicacion`, `hasOrdenProvision`. Kinds: `pliego`, `circular`, `llamado`, `acta_apertura`, `nomina_oferentes`, `cuadro_comparativo`, `informe_comision`, `preadjudicacion`, `adjudicacion`, `orden_provision`, `documento_provision`, `planimetria`, `otros` |
| Provenance                     | `detailFetched`, `detailError` (`UNPUBLISHED` when the site reports the process as not published), `contentHash` (the delta engine's change key)                                                                                                                                  |

The dataset also exposes five ready-made views from the Output tab or the API (`?view=overview`, `?view=deadlines`, `?view=documents`, `?view=buyers`, `?view=changes`), plus CSV and Excel export. Records are appended oldest-first within a run (see Reliability below); read newest-first with `?desc=true`.

## Reliability

Delta mode (`onlyNew: true`) is a stateful engine, not a date filter, because the register itself exposes no publication or modification timestamp and gives amendments no trace in the listing:

1. **Baseline run.** The first run walks each selected `estados` list newest-created first (`idGestion` descending, verified to paginate contiguously) and delivers up to `maxItems` processes, remembering for each one its list and a fingerprint of its detail page in a private, named key-value store (`santafe-compras-monitor-state-<deltaStateName>`). Everything created before the oldest process it delivered is treated as history and never delivered later - a small `maxItems` on the first run keeps the baseline cheap.
2. **New and status-change detection.** Every later run walks each list newest-first again and stops once it meets known rows. A process never seen before is `NEW_LISTING`; a known process found in a different list is `STATUS_CHANGE` with `previousEstado` set. Because the AP and ET lists are small enough to walk in full each run, a process that vanished from them is probed on its own detail page - if it now reads _En Trámite_ or _Concluida_, it is delivered as `STATUS_CHANGE` even when the CO list itself is not monitored.
3. **Amendment detection.** With `fetchDetail: true`, the Actor re-reads the detail page of every known process whose opening falls within `recheckWindowDays` or in the future, compares the stored fingerprint (`contentHash`, covering estado, dates, places, budget, expedientes, notes and the document list) and delivers only real changes as `UPDATED`. These re-reads are not charged.
4. **Crash safety.** Records are delivered oldest-first and delta memory is written only for records actually stored, so a spending limit, timeout or platform migration mid-run never loses a process - the next run picks up where it left off instead of re-starting the walk.
5. **Isolation.** Different filter sets get separate delta memories automatically; set `deltaStateName` to share one on purpose, and `resetState: true` to forget everything and re-baseline.

The Actor also validates every listing response and fails the run loudly instead of returning an empty, "successful" dataset if the site's markup changes.

## Pricing

This Actor is pay-per-event, not pay-per-compute-unit - platform usage is included in the event price:

| Event             | Price                  | When                                                                                                |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `result`            | $0.003 per record       | A record built with the full detail page (buyer, budget, deadline, rubros, documents, fingerprint)   |
| `result-summary`    | $0.001 per record       | A listing-only record (`fetchDetail: false`, or a detail page the site reports as not published)     |
| Actor start         | $0.00005                | Once per run                                                                                          |

A quiet monitoring run that finds nothing new costs only the start fee. Detail requests spent on amendment re-checks (`recheckWindowDays`) and the status sweep are not charged unless they turn into a delivered record. Check the Actor's Pricing tab on Apify Store for the current, authoritative rates.

## Support & Enterprise SLA

This is an independently developed and maintained Actor, not an enterprise vendor product - there is no contractual SLA. Bug reports and feature requests are welcome through the **Issues** tab of the Actor on Apify Store, and are typically answered within about 48 hours. Versioned changes are listed in the Actor's Changelog tab.
