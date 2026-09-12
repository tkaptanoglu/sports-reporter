import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadConfig } from '../src/config/load.js';
import { detectContextFlags, involvesFavourite, isDecider, isDerby } from '../src/scoring/context-flags.js';
import { scoreSignificance } from '../src/scoring/significance.js';
import { scoreEvent } from '../src/scoring/importance.js';
import { makeEvent } from './helpers.js';

const config = loadConfig(join('test', 'fixtures', 'config'));
const real = loadConfig();

/** A config with no rivalries, deciders or favourites of any kind. */
const bare = { ...config, context: {}, interests: { ...config.interests, favourites: [] } };

const football = config.context.rivalries?.['football'] ?? [];
const cycling = config.context.deciders?.['cycling'] ?? [];

describe('isDerby', () => {
  test('finds a rivalry from the two named teams', () => {
    const event = makeEvent({
      participants: ['Manchester United', 'Manchester City'],
      title: 'Manchester United vs Manchester City',
    });
    assert.equal(isDerby(event, football), true);
  });

  test('does not fire when only one half of the pair is playing', () => {
    const event = makeEvent({
      participants: ['Manchester United', 'Chelsea'],
      title: 'Manchester United vs Chelsea',
    });
    assert.equal(isDerby(event, football), false);
  });

  test('is not fooled by two clubs sharing a word', () => {
    // Both halves of the Manchester pair contain "Manchester". Matching on the
    // full name is what stops a Manchester United home game against anyone
    // from reading as a derby.
    const event = makeEvent({
      participants: ['Manchester City', 'Nottingham Forest'],
      title: 'Manchester City vs Nottingham Forest',
    });
    assert.equal(isDerby(event, football), false);
  });

  test('matches a short name inside the long one a feed actually uses', () => {
    // The list says "Tottenham". ESPN says "Tottenham Hotspur".
    const event = makeEvent({
      participants: ['Arsenal', 'Tottenham Hotspur'],
      title: 'Arsenal vs Tottenham Hotspur',
    });
    assert.equal(isDerby(event, football), true);
  });

  test('folds accents, so one spelling in the list covers both in the feed', () => {
    // The list is written without diacritics; a feed may use them.
    const event = makeEvent({
      participants: ['Galatasaray', 'Fenerbahçe'],
      title: 'Galatasaray vs Fenerbahçe',
    });
    assert.equal(isDerby(event, football), true);
  });

  test('works from the title alone when a source names no participants', () => {
    // TheSportsDB gives some sports only an event title.
    const event = makeEvent({ participants: [], title: 'Galatasaray vs Fenerbahce' });
    assert.equal(isDerby(event, football), true);
  });

  test('finds nothing when the sport has no list', () => {
    assert.equal(isDerby(makeEvent({ participants: ['A', 'B'] }), []), false);
  });
});

describe('isDecider', () => {
  test('finds the stage a grand tour is settled on', () => {
    // The race name and stage live in the title; the league says only
    // "UCI World Tour". Both phrases still have to be found.
    const event = makeEvent({
      sport: 'cycling',
      competition: 'UCI World Tour',
      title: 'Vuelta a España Stage 21',
    });
    assert.equal(isDecider(event, cycling), true);
  });

  test('does not fire on an earlier stage of the same race', () => {
    const event = makeEvent({
      sport: 'cycling',
      competition: 'UCI World Tour',
      title: 'Vuelta a España Stage 20',
    });
    assert.equal(isDecider(event, cycling), false);
  });

  test('does not let stage 2 match stage 21', () => {
    // Whole-word matching. A substring check would fire on every stage from
    // 21 to 29 for a rule written "stage 2".
    const event = makeEvent({ sport: 'cycling', title: 'Vuelta a España Stage 2' });
    assert.equal(isDecider(event, [['Vuelta a Espana', 'stage 21']]), false);
  });

  test('does not fire on the same stage number of a different race', () => {
    const event = makeEvent({ sport: 'cycling', title: 'Tour de Suisse Stage 21' });
    assert.equal(isDecider(event, cycling), false);
  });

  test('a single phrase is a complete rule', () => {
    const event = makeEvent({ sport: 'formula1', competition: 'Tag Heuer Abu Dhabi Grand Prix' });
    assert.equal(isDecider(event, config.context.deciders?.['formula1'] ?? []), true);
  });

  test('recognises a decider the feed states outright, with no rule at all', () => {
    assert.equal(isDecider(makeEvent({ stage: 'Final Stage' }), []), true);
    assert.equal(isDecider(makeEvent({ title: 'Season Finale' }), []), true);
  });

  test('finds nothing on an ordinary fixture', () => {
    assert.equal(isDecider(makeEvent({ title: 'Liverpool vs Fulham' }), []), false);
  });
});

describe('involvesFavourite', () => {
  const favourites = config.interests.favourites;

  test('finds a favourite among the named players', () => {
    const event = makeEvent({
      sport: 'snooker',
      participants: ['Ronnie O’Sullivan', 'Judd Trump'],
      title: 'Ronnie O’Sullivan vs Judd Trump',
    });
    assert.equal(involvesFavourite(event, favourites), true);
  });

  test('matches a favourite however the feed punctuates the name', () => {
    // "O'Sullivan" with a typewriter apostrophe, a curly one, or none at all.
    for (const spelling of ["Ronnie O'Sullivan", 'Ronnie O’Sullivan', 'Ronnie OSullivan']) {
      assert.equal(involvesFavourite(makeEvent({ title: `${spelling} vs Judd Trump` }), favourites), true, spelling);
    }
  });

  test('ignores a fixture your favourites are not in', () => {
    const event = makeEvent({ participants: ['Judd Trump', 'Kyren Wilson'] });
    assert.equal(involvesFavourite(event, favourites), false);
  });

  test('confines a favourite pinned to a sport to that sport alone', () => {
    // "Amed" is listed for football only, so the basketball club of the same
    // name earns nothing.
    const inFootball = makeEvent({ sport: 'football', participants: ['Amed SFK', 'Kasimpasa'] });
    const elsewhere = makeEvent({ sport: 'basketball', participants: ['Amed', 'Anadolu Efes'] });

    assert.equal(involvesFavourite(inFootball, favourites), true);
    assert.equal(involvesFavourite(elsewhere, favourites), false);
  });

  test('matches a short name inside the longer one a feed uses', () => {
    // The list says "Amed". ESPN says "Amed SFK".
    assert.equal(involvesFavourite(makeEvent({ sport: 'football', title: 'Amed SFK vs Genclerbirligi' }), favourites), true);
  });

  test('separates a national team from the men’s side of the same name', () => {
    // Every feed names national sides by country alone. Without the division
    // this would boost both teams, which is the opposite of what was asked.
    const turkey = [{ name: 'Turkey', sport: 'volleyball', division: 'women' as const }];

    const womens = makeEvent({
      sport: 'volleyball',
      competition: 'Womens European Volleyball Championship',
      participants: ['Turkey Volleyball', 'Italy Volleyball'],
    });
    const mens = makeEvent({
      sport: 'volleyball',
      competition: 'Mens European Volleyball Championship',
      participants: ['Turkey Volleyball', 'Italy Volleyball'],
    });

    assert.equal(involvesFavourite(womens, turkey), true);
    assert.equal(involvesFavourite(mens, turkey), false);
  });

  test('an unmarked competition is not assumed to be the division you pinned', () => {
    const turkey = [{ name: 'Turkey', sport: 'volleyball', division: 'women' as const }];
    const unclear = makeEvent({
      sport: 'volleyball',
      competition: 'Nations League',
      participants: ['Turkey Volleyball', 'Italy Volleyball'],
    });

    assert.equal(involvesFavourite(unclear, turkey), false);
  });

  test('finds nothing when you have named no favourites', () => {
    assert.equal(involvesFavourite(makeEvent({ participants: ['Ronnie O’Sullivan'] }), []), false);
  });
});

describe('detectContextFlags', () => {
  test('raises both flags when both are earned', () => {
    const event = makeEvent({
      sport: 'football',
      title: 'Manchester United vs Manchester City',
      participants: ['Manchester United', 'Manchester City'],
      stage: 'Season Finale',
    });

    assert.deepEqual(detectContextFlags(event, config), ['derby', 'title-decider']);
  });

  test('still claims nothing it cannot prove', () => {
    // The flags needing league standings stay unraised, as before.
    const event = makeEvent({ title: 'Coventry City vs Brighton & Hove Albion' });
    assert.deepEqual(detectContextFlags(event, config), []);
  });

  test('raises nothing at all without a context file', () => {
    const event = makeEvent({ participants: ['Manchester United', 'Manchester City'] });
    assert.deepEqual(detectContextFlags(event, bare), []);
  });
});

describe('the flags reaching a score', () => {
  test('a derby outscores the same fixture between strangers', () => {
    // The question that started this: two Premier League matches, one a derby.
    const derby = scoreEvent(
      makeEvent({
        title: 'Manchester United vs Manchester City',
        participants: ['Manchester United', 'Manchester City'],
      }),
      real,
    );
    const ordinary = scoreEvent(
      makeEvent({
        title: 'Coventry City vs Brighton & Hove Albion',
        participants: ['Coventry City', 'Brighton & Hove Albion'],
      }),
      real,
    );

    assert.ok(derby.importance > ordinary.importance);
    assert.deepEqual(
      derby.breakdown.flags.map((f) => f.flag),
      ['derby'],
    );
    assert.deepEqual(ordinary.breakdown.flags, []);
  });

  test('the final stage of a grand tour outscores an ordinary one', () => {
    const decider = scoreSignificance(
      makeEvent({ sport: 'cycling', competition: 'UCI World Tour', title: 'Vuelta a España Stage 21' }),
      real,
    );
    const ordinary = scoreSignificance(
      makeEvent({ sport: 'cycling', competition: 'UCI World Tour', title: 'Vuelta a España Stage 12' }),
      real,
    );

    assert.ok(decider.significance > ordinary.significance);
    assert.deepEqual(
      decider.breakdown.flags.map((f) => f.flag),
      ['title-decider'],
    );
  });

  test('the breakdown says what each flag was worth', () => {
    const derby = scoreSignificance(
      makeEvent({ participants: ['Arsenal', 'Tottenham Hotspur'] }),
      real,
    );

    assert.deepEqual(derby.breakdown.flags, [
      { flag: 'derby', adjustment: real.rules.context['derby'] },
    ]);
  });
});
