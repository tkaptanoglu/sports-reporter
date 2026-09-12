import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadConfig } from '../src/config/load.js';
import { detectContextFlags } from '../src/scoring/context-flags.js';
import { matchCompetition } from '../src/scoring/match-competition.js';
import { scoreSignificance } from '../src/scoring/significance.js';
import { matchStage } from '../src/scoring/stage.js';
import { scoreEvent } from '../src/scoring/importance.js';
import { normalise } from '../src/scoring/text.js';
import { notImplemented } from '../src/util/todo.js';
import { makeEvent } from './helpers.js';

/**
 * Mechanics are tested against the fixture table, not the shipped one.
 *
 * config/rules.yaml belongs to the user and they edit it constantly, including
 * deleting whole sports they do not follow. A matcher test that named a sport
 * from that file would fail the day they removed it, which would be a false
 * alarm about their config rather than a real fault in the matcher.
 *
 * The exception is the two anchor cases, which are the whole point of pinning
 * them to the real file.
 */
const config = loadConfig(join('test', 'fixtures', 'config'));
const real = loadConfig();

const football = config.rules.sports['football']?.competitions ?? {};
const formula1 = config.rules.sports['formula1']?.competitions ?? {};
const basketball = config.rules.sports['basketball']?.competitions ?? {};

describe('normalise', () => {
  test('folds accents so one rule covers both spellings of a name', () => {
    assert.equal(normalise('Süper Lig'), 'super lig');
    assert.equal(normalise('Türkiye Kupası'), 'turkiye kupasi');
    assert.equal(normalise('Liège-Bastogne-Liège'), 'liege bastogne liege');
  });

  test('flattens punctuation and spacing', () => {
    assert.equal(normalise('TFF 3. Lig'), 'tff 3 lig');
    assert.equal(normalise('  Semi-Final  '), 'semi final');
  });
});

describe('matchCompetition', () => {
  test('finds an exact name whatever the case', () => {
    assert.equal(matchCompetition('premier league', football)?.name, 'Premier League');
    assert.equal(matchCompetition('PREMIER LEAGUE', football)?.base, 6);
  });

  test('finds a rule inside a longer name the feed invented', () => {
    // Sponsors get prepended constantly. A rule must survive that.
    assert.equal(
      matchCompetition('Tag Heuer Monaco Grand Prix', formula1)?.name,
      'Monaco Grand Prix',
    );
  });

  test('prefers the most specific rule when a general one would also match', () => {
    // Both "Monaco Grand Prix" and "Grand Prix" are in the table and both fit.
    // Longest first is what stops the vaguer rule swallowing the race.
    assert.equal(matchCompetition('Monaco Grand Prix', formula1)?.base, 8);
    assert.equal(matchCompetition('Hungarian Grand Prix', formula1)?.base, 6);
  });

  test('matches whole words only, so NBA does not claim a WNBA fixture', () => {
    assert.equal(matchCompetition('WNBA', basketball)?.name, 'WNBA');
    assert.equal(matchCompetition('NBA', basketball)?.name, 'NBA');
  });

  test('ignores accents in either direction', () => {
    assert.equal(matchCompetition('Turkish Super Lig', football)?.name, 'Süper Lig');
    assert.equal(matchCompetition('Süper Lig', football)?.name, 'Süper Lig');
  });

  test('resolves a Turkish name however the feed spells it', () => {
    // The dotless i has no accented form to decompose, so it needs folding by
    // hand or the whole name stops matching its own rule.
    assert.equal(matchCompetition('Türkiye Kupası', football)?.name, 'Türkiye Kupası');
    assert.equal(matchCompetition('Turkiye Kupasi', football)?.name, 'Türkiye Kupası');
  });

  test('returns null rather than guessing', () => {
    assert.equal(matchCompetition('Kit Kat Invitational', football), null);
    assert.equal(matchCompetition('', football), null);
  });
});

describe('matchStage', () => {
  test('reads a knockout round out of a headline that also names the competition', () => {
    // This is the shape ESPN actually returns, competition name and all.
    const match = matchStage('football', 'UEFA Champions League - Quarterfinals', config.rules);
    assert.equal(match?.key, 'quarter-final');
  });

  test('does not mistake a semi-final for a final', () => {
    // "Semifinals" contains "final". Pattern order is the only thing stopping
    // every semi-final in the calendar from scoring as a final.
    assert.equal(matchStage('football', 'Semifinals', config.rules)?.key, 'semi-final');
    assert.equal(matchStage('football', 'Semi-Final', config.rules)?.key, 'semi-final');
    assert.equal(matchStage('football', 'Quarterfinals', config.rules)?.key, 'quarter-final');
    assert.equal(matchStage('football', 'Final', config.rules)?.key, 'final');
  });

  test('treats a UEFA league phase as the group stage it replaced', () => {
    const match = matchStage('football', 'UEFA Europa League - League Phase', config.rules);
    assert.equal(match?.key, 'group');
    assert.equal(match?.adjustment, -1);
  });

  test('a qualifier is a qualifier before it is an early round', () => {
    // ESPN labels tennis qualifying as "Qualifying 1st Round", which matches
    // both patterns. Reading it as an early round would overrate every
    // qualifier in every draw, all season.
    const match = matchStage('tennis', 'Qualifying 1st Round', config.rules);
    assert.equal(match?.key, 'qualifying');
    assert.equal(match?.adjustment, -5);
  });

  test('the same words mean different things in different sports', () => {
    // Golf numbers its rounds; tennis lumps its early ones together. Only the
    // sport's own table is consulted, never the other's.
    assert.equal(matchStage('golf', 'Round 1', config.rules)?.key, 'round-1');
    assert.equal(matchStage('tennis', 'Round 1', config.rules)?.key, 'early-round');
  });

  test('uses the sport’s own curve rather than the shared default', () => {
    assert.equal(matchStage('football', 'Final', config.rules)?.adjustment, 2);
    assert.equal(matchStage('tennis', 'Final', config.rules)?.adjustment, 1);
  });

  test('ignores a stage the sport has no rule for', () => {
    // Tennis has no group stage, so a stray "Group A" must change nothing
    // rather than borrow football's adjustment.
    assert.equal(matchStage('tennis', 'Group A', config.rules), null);
  });

  test('returns null for no stage and for one it cannot read', () => {
    assert.equal(matchStage('football', null, config.rules), null);
    assert.equal(matchStage('football', 'Matchup 7', config.rules), null);
    assert.equal(matchStage('football', '', config.rules), null);
  });
});

describe('scoreSignificance', () => {
  test('the two anchor cases from the brief', () => {
    // These calibrate the entire table. If either moves, everything else is
    // suspect, so they are asserted against the real shipped rules.
    const worldCupFinal = scoreSignificance(
      makeEvent({ competition: 'FIFA World Cup', stage: 'Final' }),
      real.rules,
    );
    assert.equal(worldCupFinal.significance, 10);

    const thirdDivision = scoreSignificance(
      makeEvent({ competition: 'TFF 3. Lig', stage: null }),
      real.rules,
    );
    assert.equal(thirdDivision.significance, 1);
  });

  test('adds the stage adjustment to the base', () => {
    const result = scoreSignificance(makeEvent({ stage: 'Final' }), config.rules);
    assert.equal(result.breakdown.base, 6);
    assert.equal(result.breakdown.stageAdjustment, 2);
    assert.equal(result.significance, 8);
  });

  test('falls back to the broader competition when the specific one has no rule', () => {
    const result = scoreSignificance(
      makeEvent({ competition: 'Kit Kat Invitational', competitionFallback: 'FA Cup' }),
      config.rules,
    );

    assert.equal(result.breakdown.matchedCompetition, 'FA Cup');
    assert.equal(result.significance, 4);
  });

  test('prefers the specific rule over the fallback when both would match', () => {
    const result = scoreSignificance(
      makeEvent({ competition: 'Premier League', competitionFallback: 'FA Cup' }),
      config.rules,
    );

    assert.equal(result.breakdown.matchedCompetition, 'Premier League');
  });

  test('an unknown competition scores the default and is recorded as unmatched', () => {
    const result = scoreSignificance(
      makeEvent({ competition: 'Kit Kat Invitational', competitionFallback: null }),
      config.rules,
    );

    assert.equal(result.breakdown.matchedCompetition, null);
    assert.equal(result.significance, config.rules.defaults.unknown_competition);
  });

  test('clamps to the ceiling and says that it did', () => {
    // An Olympic final is already a 10 before the stage bonus is added.
    const result = scoreSignificance(
      makeEvent({ sport: 'tennis', competition: 'Olympic Tennis', stage: 'Final' }),
      config.rules,
    );

    assert.equal(result.breakdown.base, 10);
    assert.equal(result.significance, 10);
    assert.equal(result.breakdown.clamped, true);
  });

  test('never clamps silently when it did not need to', () => {
    const result = scoreSignificance(makeEvent(), config.rules);
    assert.equal(result.breakdown.clamped, false);
  });

  test('returns a breakdown complete enough to explain the number', () => {
    const result = scoreSignificance(
      makeEvent({ sport: 'tennis', competition: 'Wimbledon', stage: 'Quarterfinals' }),
      config.rules,
    );

    assert.deepEqual(result.breakdown, {
      matchedCompetition: 'Wimbledon',
      base: 9,
      stageKey: 'quarter-final',
      stageAdjustment: -1,
      flags: [],
      clamped: false,
    });
    assert.equal(result.significance, 8);
  });

  test('refuses a sport with no rules block rather than scoring it as zero', () => {
    assert.throws(
      () => scoreSignificance(makeEvent({ sport: 'quidditch' }), config.rules),
      /No rules for sport/,
    );
  });
});

describe('scoreEvent', () => {
  test('multiplies your interest by the significance', () => {
    const result = scoreEvent(makeEvent({ stage: 'Final' }), config);

    assert.equal(result.interest, 8);
    assert.equal(result.significance, 8);
    assert.equal(result.importance, 64);
  });

  test('a sport you barely follow cannot outrank one you love', () => {
    // Fixture interests: football 8, tennis 4. A Wimbledon final is a perfect
    // 10 in tennis and still loses to an ordinary league match.
    const wimbledonFinal = scoreEvent(
      makeEvent({ sport: 'tennis', competition: 'Wimbledon', stage: 'Final' }),
      config,
    );
    const leagueMatch = scoreEvent(makeEvent(), config);

    assert.equal(wimbledonFinal.significance, 10);
    assert.equal(wimbledonFinal.importance, 40);
    assert.equal(leagueMatch.importance, 48);
    assert.ok(leagueMatch.importance > wimbledonFinal.importance);
  });

  test('refuses an event in a sport you never asked for', () => {
    assert.throws(
      () => scoreEvent(makeEvent({ sport: 'curling' }), config),
      /not in interests\.yaml/,
    );
  });
});

describe('detectContextFlags', () => {
  test('claims nothing, because it can currently prove nothing', () => {
    // Deliberate, not an oversight. A wrongly applied title-decider flag would
    // push a meaningless fixture to the top of a Saturday with no explanation.
    assert.deepEqual(detectContextFlags(makeEvent()), []);
    assert.deepEqual(detectContextFlags(makeEvent({ title: 'Derby Day', stage: 'Final' })), []);
  });
});

describe('what is still unwritten', () => {
  test('notImplemented names what is missing', () => {
    assert.throws(() => notImplemented('the thing'), /Not implemented yet: the thing/);
  });

});
