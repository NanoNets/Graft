# Northwind Glossary

**Dunning**: The automated process of retrying failed payments and notifying
customers before suspending an account. Owned by the Payments team.

**past_due**: The subscription state entered after three failed charge retries.
An account in past_due for 7 days is automatically suspended.

**SLO**: Northwind's charge success rate service-level objective is 97%. The
error budget is exhausted if the rate drops below 95% for 30 minutes.

**Blue-green deploy**: The Platform team's deployment strategy. New versions are
rolled out to a green environment on Kubernetes before traffic is switched over.

**On-call**: Each team runs a weekly PagerDuty rotation. The billing rotation is
`northwind-billing`; the platform rotation is `northwind-platform`.
