# Public teaching embeds

Each customer uses a dedicated `viewer` account and one active, reusable embed
key. Share farms with that account using the normal sharing screen. All farms
and simulations shared with the account are accessible to anyone who obtains
its key. The URL selects the starting view; it does not restrict access to that
farm or simulation.

Viewers use the same frontend screens and controls as editors. The API rejects
edits, copies, sharing, calculation requests, and unapproved reads with `403`.
There is no separate viewer interface or client-side write suppression.

## Manual provisioning

Apply database migrations before deploying this version. Existing accounts and
ordinary registrations retain the `editor` role. These commands use the backend's
configured database and are intended to be run manually by an operator:

```bash
cd backend
pixi run db-migrate
pixi run python -m app.embed_keys create teaching@example.com
```

`create` creates a verified viewer account with a random, undisclosed password
and prints its embed key once. It refuses to replace an existing account. No
password needs to be distributed to the customer or learners.

```bash
pixi run python -m app.embed_keys rotate teaching@example.com
pixi run python -m app.embed_keys revoke teaching@example.com
pixi run python -m app.embed_keys issue teaching@example.com
```

`rotate` revokes the previous key and prints a replacement. `revoke` disables
the active key. `issue` is for a verified viewer without an active key. Keys
remain valid until revoked or rotated; only their SHA-256 hashes are stored.
Changing the account to an editor also invalidates its embed keys. The public
API provides no role-changing or key-management operations.

Keep at least one editor on every shared farm, economics profile, and rotation
group. Viewers cannot maintain or reshare resources. Prepare farm history and
simulation results as an editor before sharing the material: viewer reads never
prepare missing history or launch calculation jobs.

## Customer integration

```html
<iframe
  src="https://plantperform.cordulus.com/farms/FARM_ID?simulation=SIMULATION_ID#key=EMBED_KEY"
  title="PlantPerform example"
  loading="lazy"
  width="100%"
  height="700">
</iframe>
```

Use the same key in each iframe and change the farm and optional `simulation`
parameter. `/#key=EMBED_KEY` opens the farm list. No customer backend,
parent-page JavaScript, learner login, or third-party cookie access is required.
If the host sets an iframe sandbox, it must allow scripts and same-origin access
(`allow-scripts allow-same-origin`); otherwise the embedded application cannot
request its own API normally.

The presence of a `key` fragment parameter selects embed authentication once at
page startup, even when an existing PlantPerform login is available. Empty,
malformed, or revoked keys show an unavailable message without falling back to
that login. Pages without the parameter use normal authentication; unrelated
fragments such as password-reset tokens do not select embed authentication.

Each iframe keeps its credential in memory and preserves the key fragment during
navigation. The fragment is not sent as part of the document request. API and
map requests use the key in the Authorization header and omit cookies. Existing
PlantPerform login sessions are not restored, refreshed, or logged out by embeds.
Both authentication modes load `/api/v0/auth/me`. Embed credentials receive
`{"email": null, "role": "viewer"}`; normal credentials receive the account email
and role. Membership identities remain inaccessible to embed credentials.
Signing out of an embed only clears its local authenticated state; reloading a
URL containing a valid key opens it again.

Unsharing a farm blocks subsequent requests for that farm. Revocation blocks
subsequent requests using the key with `401`. Already displayed or downloaded
data cannot be retracted. Viewer API responses use `Cache-Control: no-store`.

The deployment repository's HAProxy configuration allows all application pages,
including account pages, to be framed by HTTPS sites, and applies
`Referrer-Policy: no-referrer` globally. The frontend must be served with these
response headers; a meta tag cannot set `frame-ancestors`. Deploy the reviewed
configuration manually. The old embed-specific page URLs and bootstrap endpoint
are not supported.

## Verification

Backend authorization and key-lifecycle integration tests use isolated schemas
when `OPTIMIZER_TEST_DATABASE_URL` is set. Never point this variable at a production
database. Frontend tests cover cookie omission, key preservation, normal-session
isolation, and forwarding writes to the API for rejection.

For browser acceptance, put multiple embeds on a different HTTPS origin. Check
Chrome, Firefox, and Safari with third-party cookies/storage blocked, including
an existing editor login, navigation/reload, write rejection, unsharing, and key
revocation. Review API status codes and ensure viewer traffic starts no jobs.
