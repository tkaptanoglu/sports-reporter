# sports-reporter

Ranks the next seven days of sport by how much you personally should care.

You declare which sports you follow and how much, from 1 to 10. A rules table
scores each upcoming event for how significant it is within its own sport, also
0 to 10. The report sorts every day by the product of the two.

    importance = your interest in the sport x the event's significance in it

Multiplication, not addition. A sport you rated 1 can never crowd out a sport
you rated 9, however big its final is.

## Status

Works end to end. Fetches, scores, ranks and prints.

| Working | Stubbed |
| --- | --- |
| Config loading and validation | Context flag detection |
| Timezone-aware day windows | |
| All three data sources | |
| Competition and stage matching | |
| Significance and ranking | |
| Terminal summary and HTML report | |

Context flags are stubbed deliberately rather than half-written. Detecting a
title decider needs league standings and the fixtures left to play; a derby
needs a rivalry list. Until it can prove a flag from the data it claims none,
because a wrongly applied one would push a meaningless fixture to the top of
your Saturday with nothing to explain why.

## Scoring

Three layers, then a clamp to 0..10.

    significance = base + stage adjustment + context adjustments
    importance   = your interest in the sport x that significance

Competition names are matched on whole words, accent-insensitive, longest rule
first. That is what lets one rule for `Monaco Grand Prix` survive a feed calling
it "Tag Heuer Monaco Grand Prix", lets `Süper Lig` match a feed writing "Turkish
Super Lig", and stops the `NBA` rule claiming a WNBA fixture.

Stage text is matched against a synonym table, and only against the stage keys
the sport actually declares. "Round 1" therefore means the first round of a golf
tournament in one sport and an early round of a draw in another.

Every scored event carries a full breakdown: which rule matched, the base, which
stage fired, each flag, and whether the total was clamped. Without it, tuning
`rules.yaml` would be guesswork.

## Sources

Three of them, deliberately not overlapping. Two sources describing one fixture
would produce two entries, because they arrive under different ids.

| Source | Sports | Notes |
| --- | --- | --- |
| ESPN | football, tennis, basketball, Formula 1 | No key, no cap, ~30 leagues |
| TheSportsDB | cycling, athletics, MotoGP, snooker, volleyball, handball | Free key is capped, see below |
| Calendars | whatever you configure | iCalendar feeds, none shipped |

**Ski jumping, alpine skiing and curling have no source.** Neither API carries
them in any form, and FIS, World Curling and the EHF all publish their
schedules as rendered HTML with no feed behind them. The calendar source exists
for exactly this: point it at any `.ics` URL by creating `config/calendars.yaml`.

    feeds:
      - sport: alpine-skiing
        competition: FIS Alpine Ski World Cup
        url: https://example.org/whatever.ics

**TheSportsDB's public test key returns at most three events per query** and
starts refusing requests after a few dozen, so those six sports report a
fraction of what is on. That is their limit, not a bug here, and it is logged
on every run. Set `THESPORTSDB_KEY` in the environment to use your own key.

ESPN also has no Turkish cup endpoint under any slug, and nothing below the
Turkish second tier, so `TFF 2. Lig` and `TFF 3. Lig` never appear.

## Running it

    npm install
    npm start

Windows, Node 20 or newer. There is no build step for normal use; `npm start`
runs the TypeScript directly.

It prints a summary to the terminal and writes the real report to
`reports/<date>.html`, naming the path on the last line. Open that file in a
browser. It is entirely self-contained, so it still renders years later with no
network, and it follows your system light or dark setting. Each event opens to
show the arithmetic behind its score, and three buttons hide the low scorers
when a week runs to two hundred fixtures. `reports/` is in `.gitignore`.

## Tests

    npm test

63 tests on Node's built-in runner, no test framework dependency. Watch mode is
`npm run test:watch`.

They cover what is actually written: day windows across timezones and clock
changes, config loading, source orchestration, and the grouping and ranking in
the report. Two things are worth knowing about how they are set up.

Most tests run against small fixtures in `test/fixtures/`, but `real-config.test.ts`
asserts against the two YAML files that actually ship, so a stray tab or a
renamed sport fails in a second rather than halfway through a run. It checks
your own `interests.yaml` too when it is present, and skips that one test when
it is not, so the suite stays green on a fresh clone.

The stubs are tested as well, asserting that they stop rather than return a
plausible number. A scorer that quietly returned zero would look like a working
program producing a boring week.

To check that everything, tests included, still compiles:

    npm run typecheck

## Configuration

Two files in `config/`, both YAML with comments explaining themselves.

`interests.yaml` is yours. It holds your sports, your ratings, and your
timezone. It is deliberately not tracked in git, so it never leaves your
machine. Copy `interests.example.yaml` to start one.

`rules.yaml` is the scoring table: 21 sports and 239 competitions, each with a
base score, plus stage adjustments and context flags. It is tracked, because it
is the program's logic rather than personal data.

A competition the table has never seen scores the unknown default and is listed
at the foot of the report, so the table grows through use instead of needing to
be complete up front.

## Layout

    src/
      index.ts            the pipeline, in the order it happens
      config/             reading and validating the two YAML files
      model/              SportEvent and ScoredEvent, the shared vocabulary
      sources/            one file per place events come from
      scoring/            base, stage, context, then interest x significance
      report/             grouping, sorting, and the two renderers
      util/               day windows and logging

Sources are kept behind one narrow interface on purpose. The rest of the
program cannot tell a JSON API from a scraped page, so when a site changes its
markup only one file needs attention.
