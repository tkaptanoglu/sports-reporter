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

| Working | Not yet |
| --- | --- |
| Config loading | Standings-based context flags |
| Timezone-aware day windows | |
| All three data sources | |
| Competition and stage matching | |
| Derby and decider flags | |
| Significance and ranking | |
| Terminal summary and HTML report | |

Two of the context flags are live: `derby` and `title-decider`, both driven by
`config/context.yaml`. The rest stay unraised on purpose. A relegation
six-pointer or a live title race needs league standings and the fixtures left
to play, which means a standings source and real arithmetic, not a list. Until
a flag can be proved it is never claimed, because a wrongly applied one would
push a meaningless fixture to the top of your Saturday with nothing to explain
why.

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
| TheSportsDB | cycling, athletics, MotoGP, volleyball, handball | Free key is capped, see below |
| snooker.org | snooker | Scraper. Names the players |
| FIS | ski jumping | Scraper. Season calendar |
| Calendars | whatever you configure | iCalendar feeds, none shipped |

No two sources claim the same sport, and a test enforces it. Two of them
describing one fixture would produce two entries rather than one, because they
arrive under different ids and survive deduplication.

The last two are scrapers, which nothing else here is. Both exist because there
was no alternative. Ski jumping is carried by no aggregator at all, and the
snooker aggregators give you "English Open Final" without ever saying who is
playing, which in an individual sport is the only thing worth knowing.
snooker.org's own API refuses this client outright, so its HTML it is.

Flashscore was the other candidate for both and was rejected. Its terms forbid
automated access and it is built to detect and block exactly this.

Expect scrapers to break. Each fails on its own without touching another sport,
and says in the log when a page has changed shape rather than silently
reporting an empty week.

A published snooker draw only runs a round or two ahead. Where it exists you
get named players; where it does not you get one event per tournament day, the
same compromise the tennis reader makes.

**Alpine skiing and curling still have no source.** Neither API carries them,
and World Curling and FIS publish those schedules with no feed behind them. The
calendar source exists for exactly this: point it at any `.ics` URL by creating
`config/calendars.yaml`.

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

Most sports run two parallel calendars, and you may follow only one. Swap the
bare rating for the long form to take just that half:

    volleyball:
      interest: 7
      only: women
      also:
        - Sultanlar Ligi

It also holds your favourites, the teams and athletes worth a bonus wherever
they turn up:

    favourites:
      - Ronnie O'Sullivan
      - Beşiktaş
      - name: Amed
        sport: football

A bare name applies across every sport you follow; adding `sport:` pins one to
a single sport, for a club name that means different things in each. Any event
involving a favourite earns the `favourite` flag, whose size lives in
`rules.yaml` beside the other context adjustments. Names match on whole words
with accents folded and apostrophes ignored, so "Besiktas" finds Beşiktaş,
"Amed" finds both "Amed SFK" and "Amedspor", and "O'Sullivan" survives whichever
apostrophe a feed uses.

Where a source knows for certain which side it queried, that is believed. ESPN
asking the WTA endpoint is a fact, not a guess. Everywhere else the division is
read out of the competition name, in several languages, so a whole-day feed
still sorts "Mens European Volleyball Championship" from the women's one.

A competition whose name gives nothing away is dropped, on the reasoning that
one which does not call itself women's usually is not. `also` names the
exceptions, for leagues like Sultanlar Ligi whose name says nothing either way.
Every run reports how many events it removed and why, so nothing disappears
quietly.

`rules.yaml` is the scoring table: every competition with a base score, plus
stage adjustments and the size of each context bonus. It is tracked, because it
is the program's logic rather than personal data.

`context.yaml` holds what no sports feed will ever tell you. Rivalries, as pairs
of club names, and deciders, as the phrases that identify the event a
competition is settled on.

    rivalries:
      football:
        - [Manchester United, Manchester City]

    deciders:
      cycling:
        - [Vuelta a Espana, stage 21]

A fixture with both halves of a pair earns the `derby` flag. An event containing
every phrase in a decider rule earns `title-decider`. Names match on whole
words with accents folded, so "Besiktas" finds "Beşiktaş" and "Tottenham" finds
"Tottenham Hotspur".

Decider rules search the competition, the title and the stage together, because
feeds scatter the pieces. A grand tour arrives filed under "UCI World Tour" with
the race and its stage number only in the title.

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
