---
name: distill-release-notes
description: Research official fabtcg.com per-set release notes and distil them into cited judge-brain notes — one note per set, linked to the kw-* keyword corpus, with newer-trumps-older supersession checks against the current CR. Use when the user wants to ingest/update/evolve interaction knowledge from release notes for one set, several sets, or "whatever is missing".
---

# distill-release-notes

Turns official per-set release notes (https://fabtcg.com/rules-and-policy-center/release-notes/)
into judge-brain zettel notes. The judge brain is the source of truth for rules/keyword
knowledge (see `.claude/identities/judge/brain/ROLE.md`); release-notes pages are an
official "staying current" source. **HARD RULE: newer release notes + the current CR
supersede older set pages** — every ingest ends with a supersession pass.

Args: set slugs (e.g. `high-seas the-hunted`), a range ("uprising through omens"),
or nothing → ingest whatever sets have no `release-notes-<set>` note yet.

## 0. Discover scope

```bash
# All available set pages:
curl -s "https://fabtcg.com/rules-and-policy-center/release-notes/" \
  -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" \
  -H "Referer: https://fabtcg.com/" -H "Accept: text/html" \
  | grep -oE 'href="[^"]*release-notes/[^"]+"' | sort -u
# Already ingested:
ls .claude/identities/judge/brain/notes/ | grep '^release-notes-'
```

fabtcg.com WAF-blocks plain fetches — ALWAYS send the browser headers above
(WebFetch gets a 403; use curl).

Refresh the verification artifact before starting (needed for step 3):
`fab-cli rules update-docs` → `third_party/fab-rules/en-fab-cr.txt`.

## 1. Fan out distiller agents (one per set, parallel)

Spawn one general-purpose agent per set page, all in a single message. Each agent
fetches with the curl+headers above (plus any sub-pages of the same notes) and returns
a dense plain-text digest, max ~600 words:

```
SET: <name> | RELEASE: <date if stated>
NEW-MECHANICS: each new keyword/mechanic + core rules, 1-2 sentences each
INTERACTION-RULINGS: most judge-relevant rulings (exact card names + ruling),
  prioritizing non-obvious interactions, timing/trigger questions, table-frequency
CHANGES: anything the page flags as change/erratum/functional update (from → to)
POSSIBLY-OUTDATED: (older sets only) rulings that plausibly no longer hold under
  the current CR — quote the old claim precisely enough to verify
```

Tell agents their final message is raw data for the orchestrator, not user-facing.
Known changed areas to prompt older-set agents with: Spectra chain-close (changed in
High Seas), ally-attack defending/attacking hero (changed in Compendium of Rathe),
face-down arena objects keeping identity+counters (Compendium of Rathe), end-phase
untap step (High Seas).

## 2. Mint one note per set (orchestrator only — subagents never touch brains)

Mint incrementally as digests arrive (protects against context compaction):

```bash
B=/Users/vieiral/.claude/plugins/marketplaces/development-skills/plugins/spec-workflow/scripts/brain.sh
bash $B mint judge release-notes-<set-slug> \
  --tags "cr,release-notes,interactions,<set-slug>[,rule-changes|,errata]" \
  --source "https://fabtcg.com/rules-and-policy-center/release-notes/<set-slug>/" <<'EOF'
<body>
EOF
```

Body style (match existing notes): ONE dense ~1.5-2K paragraph. New mechanics first
with their core timing rules, then the sharpest interaction rulings with exact card
names, then flagged changes/errata. Link liberally to existing notes: `[[kw-*]]` for
every keyword involved (vocabulary: `ls .claude/identities/judge/brain/notes/ | grep '^kw-'`
— NEVER write through a kw-* symlink), plus `[[keyword-interaction-rulings]]` and
`[[release-notes-index]]`. Use `{p}/{d}/{r}/{h}` stat notation. Only content from the
fetched page enters the note — no model memory.

## 3. Supersession pass (the point of the exercise)

For every POSSIBLY-OUTDATED or conflicting claim between an older and a newer set note:

1. Verify against the CURRENT CR: `grep -in "<term>" third_party/fab-rules/en-fab-cr.txt`
   (navigate via the judge brain's `doc-map-cr` note; keywords are CR chapter 8).
2. If the old ruling no longer holds, the note must say so inline:
   `SUPERSEDED: <old claim> → now <current rule> (CR §x.y.z / [[release-notes-<newer-set>]])`.
   Never record a stale ruling as current.
3. Update `release-notes-index` (re-mint with full body — mint overwrites; it bumps
   strength and preserves `created`) so its "known changes" list stays complete.
4. Ambiguous even against the CR? Say so in the note and point to judge Discord
   #ask-a-judge rather than resolving silently.

## 4. Finish

```bash
bash $B directory            # regenerate .claude/identities/DIRECTORY.md
```

Commit + push brain updates DIRECTLY to main (knowledge maintenance, no PR — per
judge ROLE.md): notes + links.json + .activation.jsonl + DIRECTORY.md, message like
`judge brain: ingest release-notes interactions, <sets>`.

## Gotchas

- `release-notes-index` is the hub: supersession rule, known-changes list, cross-set
  recurring principles (no damage recalc after damage step; no retroactive go
  again/on-hit; no priority in start/end phase or trigger bundles; cost set-to-0 then
  increases; deck/banished destroys trigger no watchers; ward leave-arena triggers
  stack after the damage event; LKI on open chains). New recurring principles found
  during ingest belong there, not duplicated per set note.
- Re-minting an existing slug overwrites the body (strength +1, created preserved) —
  fine for updates; always re-mint the FULL body.
- One page can cover two products (bright-lights-round-the-table); a "set" arg may
  also be a mastery pack / compendium page.
- Card legality NEVER comes from release notes or the brain — live policy page only.
