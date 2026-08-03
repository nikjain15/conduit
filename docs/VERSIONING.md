# Versioning and breaking changes

Closes C3 in `docs/STAKEHOLDERS.md`, which recorded that the HTTP surface was `/v1/*` and every
package sat at `0.1.0` with no definition of what `/v1` promised or what counted as breaking.

There are two separately versioned surfaces and they do not move together.

| Surface | Versioned by | Consumers |
|---|---|---|
| HTTP gateway | the `/v1` path prefix | anything calling `services/gateway` over the network |
| npm packages | semver per package | anything importing `@conduit/*` |

## 1. What counts as breaking

This is the part a policy usually leaves vague, so it is a list. **Breaking** on either surface:

- Removing an endpoint, an exported function, a type, or a field from a response.
- Renaming any of the above. A rename is a removal plus an addition, and it breaks in exactly the
  same way.
- Narrowing a type: making an optional request field required, removing a member from a union,
  tightening a value's accepted range.
- Changing the meaning of an existing field while keeping its name and type. This is the worst
  kind, because it breaks silently: nothing fails to compile and nothing 400s, the numbers are just
  wrong from then on.
- Changing a default, when the default is observable in the output.
- Changing an error's HTTP status code, or the shape of an error body.
- Changing the order of a response array where order previously carried meaning.

**Not breaking**, and therefore allowed in a patch or minor release:

- Adding a new endpoint or a new exported function.
- Adding an **optional** request field, one that is safe to omit.
- Adding a field to a response. Consumers must ignore unknown fields; that requirement is stated
  here so that adding a field is not a breaking change by accident.
- Widening a type: accepting a new value in an input union, relaxing a range.
- Any change confined to `services/gateway` internals or to a package's non-exported code.

The worked example is `stopReason` and `notice` on `AgentResult` (ADR-0002). Both were added as
**optional**, so a core that predates stop conditions still satisfies the type and a client that
ignores them still works. Adding them as required fields would have been breaking, and the
distinction is the entire reason the fields are declared the way they are.

## 2. The HTTP surface: what `/v1` promises

`/v1` promises that the rules above hold for every route under it. A change that this document
calls breaking does not land in `/v1`; it lands in `/v2`, and `/v1` keeps working.

`/v1` is **frozen** in the sense that its existing shapes will not narrow or change meaning. It is
not frozen against additions: new routes and new optional fields keep appearing under `/v1`, which
is what makes a long support window affordable.

### The deprecation window

When `/v2` ships, `/v1` is supported for **six months** from the date `/v2` becomes the default,
and the following happens on a stated clock:

| When | What |
|---|---|
| T-0 | `/v2` documented and available. `/v1` unchanged and fully supported. `CHANGELOG.md` entry with a migration note per changed shape. |
| T-0 | Every `/v1` response carries `Deprecation: true` and `Sunset: <RFC 1123 date>` (RFC 8594), so a consumer learns from traffic rather than from a blog post. |
| T+90 days | Direct notice to every tenant with `/v1` traffic in the last 30 days. Tenants are known: every request resolves to one through the API key. |
| T+180 days | `/v1` returns `410 Gone` with a body naming `/v2` and linking the migration note. Not a 404, because a 404 reads as "you got the URL wrong" and this is "this endpoint retired on a date you were told about". |

**None of this has run**, because there is no `/v2` and no live traffic. It is the policy that
applies when there is, and the dates are relative to a `/v2` that does not exist yet rather than
invented absolute ones.

## 3. The npm packages: semver

Every `@conduit/*` package is at `0.1.0`. Under semver, `0.x` means the public API may change, and
that is currently accurate rather than a placeholder: nothing is published yet, and `PUBLISHING.md`
records that the first publish has not happened.

**On the first publish, each package goes to `1.0.0`** and the rules above start binding:

- **major** for anything in the breaking list.
- **minor** for a new export or a new optional field.
- **patch** for a fix that changes no signature.

Packages version **independently**. `@conduit/agent` going to `2.0.0` does not drag
`@conduit/rag` with it. A package whose only change is a bumped dependency on another `@conduit`
package gets the bump that its OWN surface change deserves, which is usually a patch.

Until that first publish, `0.1.0` across the board is the honest state and this section describes
what will be true rather than what is.

## 4. The changelog

`CHANGELOG.md` at the repo root, newest first, Keep a Changelog headings. Every entry that changes
either surface says which surface, and every breaking entry carries a migration note with the old
shape and the new one side by side. An entry that says "improved the agent loop" and nothing else
is not a changelog entry.

## 5. What enforces this

A policy nobody checks is prose. `scripts/check-api-surface.mjs` holds a committed snapshot of the
HTTP surface: every route, its methods, and the response field names each handler's result type
declares. It runs in CI on every pull request.

Change the surface and the check fails, printing what was added and what was removed. Adding a
route or an optional field is a one-line snapshot update, and the diff makes it visible in review.
**Removing or renaming anything shows up as a removal**, which is the case this exists to catch,
because that is the change that is easy to make by accident and impossible to take back once a
consumer has shipped against it.

The snapshot is deliberately dumb: a list, compared as sets. It cannot detect the "same name, new
meaning" break in §1, and nothing mechanical can. That one is caught by the changelog discipline
and by review, and saying so here is more useful than implying the check covers it.

## Related

- `PUBLISHING.md`, for how packages are actually released.
- `docs/adr/ADR-0002-layered-stop-conditions.md`, for the worked additive-change example.
- `docs/STAKEHOLDERS.md` C3, the gap this closes.
