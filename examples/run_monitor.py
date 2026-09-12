"""run_monitor.py
Runs santafe-compras-monitor in delta mode and prints the tenders it delivers.
"""
import os

from apify_client import ApifyClient

# Authenticate from an env var (never hardcode the token).
client = ApifyClient(os.environ["APIFY_TOKEN"])

# Hospital medicines/medical-supply monitor, matching the site's own
# AP (Para Apertura) list, delta mode, full detail enrichment.
run_input = {
    "estados": ["AP", "ET"],
    "rubro": "medicinales",
    "onlyNew": True,
    "recheckWindowDays": 30,
    "maxItems": 300,
    "fetchDetail": True,
}

# jfoq1flE7KqKb3qAb is the public santafe-compras-monitor Actor.
# .call() starts the run and waits for it to finish.
run = client.actor("jfoq1flE7KqKb3qAb").call(run_input=run_input)

print(f"Run {run['id']} finished with status: {run['status']}")

# Read the resulting dataset (one item per NEW_LISTING/STATUS_CHANGE/UPDATED tender).
dataset_items = client.dataset(run["defaultDatasetId"]).list_items().items

print(f"Delivered {len(dataset_items)} tender record(s):")
for item in dataset_items:
    label = f"{item.get('numeroAnio')} {item.get('objeto')} ({item.get('comprador')})"
    print(f"- [{item.get('event_type')}] {label}")
