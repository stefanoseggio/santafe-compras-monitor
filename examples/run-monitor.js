// run-monitor.js
// Runs santafe-compras-monitor in delta mode and logs the tenders it delivers.
const { ApifyClient } = require('apify-client');

// Authenticate from an env var (never hardcode the token).
const client = new ApifyClient({
    token: process.env.APIFY_TOKEN,
});

async function main() {
    // Hospital medicines/medical-supply monitor, matching the site's own
    // AP (Para Apertura) list, delta mode, full detail enrichment.
    const input = {
        estados: ['AP', 'ET'],
        rubro: 'medicinales',
        onlyNew: true,
        recheckWindowDays: 30,
        maxItems: 300,
        fetchDetail: true,
    };

    // jfoq1flE7KqKb3qAb is the public santafe-compras-monitor Actor.
    // .call() starts the run and waits for it to finish.
    const run = await client.actor('jfoq1flE7KqKb3qAb').call(input);

    console.log(`Run ${run.id} finished with status: ${run.status}`);

    // Read the resulting dataset (one item per NEW_LISTING/STATUS_CHANGE/UPDATED tender).
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    console.log(`Delivered ${items.length} tender record(s):`);
    for (const item of items) {
        console.log(`- [${item.event_type}] ${item.numeroAnio} ${item.objeto} (${item.comprador})`);
    }
}

main().catch((err) => {
    console.error('Actor run failed:', err.message);
    process.exit(1);
});
