# Fetched rule sources

Evidence for the Rule 4 and each-way place-terms tables in `docs/05`.

Each `rule4-*.txt` / `place-terms-*.txt` file records what was actually
retrieved from the URL at the top, on the date at the top. They are the raw
material for `COMPARISON.md`, which reconciles them.

## Read this before trusting any of it

**Not one of these is a bookmaker's published rules page.** Every UK operator
attempted returned HTTP 403 to an automated fetch — bet365, William Hill,
Ladbrokes, Coral, Paddy Power, Sky Bet, Betfred, BoyleSports — as did
`support.betfair.com`, `help.smarkets.com` and `racingpost.com`. The blocked
attempts are listed in `COMPARISON.md` §1 with their status codes.

`docs/01` §2.6 predicted this: racing sites are among the most aggressively
bot-defended on the web. It applies to their rules pages too, not just their
odds.

So the source class here is **third-party guides and calculators**, which is
weaker than what was asked for and weaker than what settlement needs. Several
of these pages are demonstrably unreliable — one publishes a deduction table
that contradicts its own worked example. Treat the reconciled table in
`COMPARISON.md` as the best available reading, not as verified.

O4 in `docs/08` — verifying these tables against an authoritative source — is
**still open**. Nothing in this directory closes it.
