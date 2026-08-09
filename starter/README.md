# Starter — verified working connection to the shared LGTM stack

`lgtm-client.js` is a real, tested client (zero dependencies — Node 22's built-in `fetch`)
against the shared hackathon observability stack. This is your actual starting point, not
`reference/sreoncall/`.

## Try it (proves your network access works before you build anything)

```bash
cd starter
node lgtm-client.js
```

Expected output:

```
Connecting to LGTM stack as tenant "hackathon"...
✓ Mimir: 326 metric names available
✓ Loki: 5 log stream(s) in the last 10 minutes
✓ Tempo: 5 recent trace(s) found

All three signal types reachable. You're connected.
```

If it hangs or errors instead, you're not on the office network/VPN (10.10.0.0/24 or
10.10.1.0/24 required) — fix that before anything else.

## Using it in your own prototype

```js
const { queryMetric, listMetricNames, queryLogs, searchTraces } = require("./lgtm-client");

const result = await queryMetric('rate(container_cpu_usage_nanoseconds_total[5m])');
```

Port this file to Python/Go/whatever if you're not building in Node — it's four small
functions wrapping plain HTTP calls with one header (`X-Scope-OrgID: hackathon`). Nothing here
is SREonCall-specific; it's just talking to Mimir/Loki/Tempo's own query APIs.

## Your interface is up to you

CLI, Slack bot, small web UI — pick whatever gets your actual agent behavior built fastest.
Nothing about the interface is judged; what it does and how it reasons is.
