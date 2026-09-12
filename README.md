# sports-reporter

Ranks the next seven days of sport by how much you personally should care.

You declare which sports you follow and how much, from 1 to 10. A rules table
scores each upcoming event for how significant it is within its own sport, also
0 to 10. The report sorts every day by the product of the two.

    importance = your interest in the sport x the event's significance in it

Multiplication, not addition. A sport you rated 1 can never crowd out a sport
you rated 9, however big its final is.

## Status

Walking skeleton. It runs end to end and reports nothing, because no data
source is implemented yet. Every stub logs `TODO` or throws a
`Not implemented yet` naming exactly what is missing.

| Working | Stubbed |
| --- | --- |
| Config loading | Every data source |
| Sport key validation | Competition name matching |
| Timezone-aware day windows | Stage matching |
| Source orchestration | Context flag detection |
| Grouping, sorting, ranking | Significance scoring |
| Terminal report | HTML report |

## Running it

    npm install
    npm start

Windows, Node 20 or newer. There is no build step for normal use; `npm start`
runs the TypeScript directly.

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
