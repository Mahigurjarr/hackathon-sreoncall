# Incident INC-1 — checkout: DNS failures to PaymentService

Summary
- Checkout’s calls to PaymentService failed DNS resolution, returning grpc UNAVAILABLE with messages like "dns: A record lookup error: lookup badAddress on 127.0.0.11:53". This produced checkout-side errors while payment showed no handling/errors.

Impact
- User checkout operations intermittently failed; frontend surfaced INTERNAL errors on /api/checkout [E115].

Root cause and evidence
- Error traces from checkout contain the DNS lookup failure string ("lookup badAddress on 127.0.0.11:53") in multiple traces [E110].
- A representative trace shows checkout’s server span marked error and the client span to PaymentService returning UNAVAILABLE with the same DNS error; the frontend also shows the failure [E115].
- Fleet metrics show a non-zero checkout error-call series during the window, i.e., checkout contributed to the error callrate [E114].
- Payment appears not to have handled these requests: traces filtered by service.name=payment showed no payment-side server spans for the failing calls [E116], and payment logs contained 0 ERROR lines in the timeframe [E113].
- Checkout p95 latency was not elevated vs. 60m-ago baseline (now 17.20 ms vs. 27.37 ms 60m prior), indicating an errors-dominant issue rather than a broad latency spike [E108].

Detection gaps
- We lacked a checkout-focused error-rate signal in alert-rules. While fleet-level views showed checkout errors [E114], a dedicated rule would have drawn targeted attention sooner to checkout erroring.

Remediation taken / recommended
- Validate DNS resolution from a checkout pod (nslookup/dig for the PaymentService hostname) and inspect resolver configuration; investigate CoreDNS/node-local DNS health and logs. If unhealthy, restart/remediate the DNS layer. After remediation, confirm via traces that PaymentService server spans are present and the DNS exception is gone [E110][E115][E116][E113].

Follow-ups in this PR
- Added an alert rule to surface checkout error spikes tied to this incident pattern [E114][E110][E115][E116][E113].
- Added a targeted runbook for checkout → payment DNS resolution failures so the agent has concrete, ordered steps the next time this pattern appears [E110][E115][E116][E113].

Out of scope
- No changes to application code or to the DNS control plane are included here; those are operational actions executed during incident response.
