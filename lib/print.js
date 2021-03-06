/**
 * Export contests to print
 */

// Dependencies
const _ = require('lodash');
const utility = require('./utility.js');
const debug = require('debug')('mn-elections-api:print');

// Print line tags
const tags = {
  heading1: '@Head1:',
  heading2: '@Elex_Head1:',
  heading3: '@Elex_Head2:',
  heading4: '@Elex_Head_Sub_Bold:',
  meta: '@Elex_Precinct:',
  note: '@Elex_Text_Question:',
  candidate: '@Elex_Text_2tabsPlusPct:',
  candidateNo: '@Elex_Text_2tabsPlusPct_Space:',
  ranked: '@Elex_Text_RCV_3choice:',
  ranked6: '@Elex_Text_RCV_6choice:',
  question: '@Elex_Text_Question:',
  space: ''
};

// Main function, takes array of contests
function toPrint(contests, section) {
  debug('Print section: ', section.title, contests.length);
  if (!contests.length) {
    return;
  }

  // Get simple objects
  contests = _.map(contests, c => {
    return _.isPlainObject(c) ? c : c.toJSON();
  });

  // For every primary that is partisan, we actually want to print twice,
  // split up
  let splitContests = [];
  let printedParties = ['D', 'DFL', 'R'];
  contests.forEach(c => {
    if (c.election.primary && c.nonpartisan !== true && !c.ranked) {
      printedParties.forEach(party => {
        let copy = _.cloneDeep(c);

        // Check that there is this party
        if (c.candidates.find(c => c.party === party)) {
          copy.candidates = c.candidates.filter(c => c.party === party);
          copy.primaryParty = party;

          // Hacky way to test for uncontested
          if (section && section.where && section.where.uncontested) {
            if (
              (section.where.uncontested === false ||
                section.where.uncontested['$not'] === true) &&
              copy.candidates.length <= 1
            ) {
              return;
            }
          }

          splitContests.push(copy);
        }
      });
    }
    else {
      splitContests.push(c);
    }
  });
  contests = splitContests;

  // Default headings
  let defaultHeadings = ['area', ['name', 'seatName', 'subArea']];

  // Place to compile lines
  let lines = [];

  // Title
  //lines.push(tags.heading1 + section.title);

  // Go through each contest
  let previous = null;
  _.each(contests, c => {
    c.sectionTitle = section.title;

    // Determine what headings we need to display
    let higherHeadingChanged = false;
    let headings = section.headings || defaultHeadings;

    _.each(section.headings || defaultHeadings, (h, hi) => {
      let sep =
        section.separators && section.separators[hi]
          ? section.separators[hi]
          : ' ';

      if (h) {
        let currentH = _.isArray(h) ? _.filter(_.pick(c, h)).join(sep) : c[h];
        let previousH = previous
          ? _.isArray(h)
            ? _.filter(_.pick(previous, h)).join(sep)
            : previous[h]
          : undefined;

        // Handle any renames
        if (section.rename && section.rename[hi]) {
          _.each(section.rename[hi], replace => {
            if (replace.length !== 2) {
              return;
            }

            currentH = currentH
              ? currentH
                .replace(new RegExp(replace[0], 'ig'), replace[1])
                .replace(/\s+/g, ' ')
                .trim()
              : currentH;
            previousH = previousH
              ? previousH
                .replace(new RegExp(replace[0], 'ig'), replace[1])
                .replace(/\s+/g, ' ')
                .trim()
              : previousH;
          });
        }

        // If heading changed or no previous or high heading changed or
        // (last heading and not higher heading change and not question)
        if (
          ((hi === headings.length - 1 &&
            !higherHeadingChanged &&
            !c.question) ||
            higherHeadingChanged ||
            !previous ||
            currentH !== previousH) &&
          currentH
        ) {
          lines.push(tags['heading' + (hi + 2)] + currentH);
          higherHeadingChanged = true;
        }
      }
    });

    // Note if no candidates (besides write-ins)
    if (
      c.candidates.length === 0 ||
      (c.candidates.length === 1 && c.candidates[0].party === 'WI')
    ) {
      lines.push(tags.note + 'No candidates running in this contest.');
      previous = c;
      return;
    }

    // Meta.  Only show open seats if not primary, or if rawseats is half seats,
    // Not best way to know.
    if (
      (!c.election.primary && c.seats > 1) ||
      (c.election.primary && c.seats > 2)
    ) {
      lines.push(tags.meta + 'Open seats: ' + c.seats);
    }

    // Question text.
    if (c.questionText) {
      lines.push(
        tags.question +
          (section.inlineQuestionTitle
            ? c.name.replace(/(.*)(question(.*))/i, '$2') +
              (c.seatName ? ' ' + c.seatName : '') +
              ': ' +
              c.questionText.replace(/\s+/gm, ' ')
            : c.questionText.replace(/\s+/gm, ' '))
      );
    }

    // Precincts
    lines.push(
      tags.meta +
        (c.precincts || 0) +
        ' of ' +
        c.totalPrecincts +
        ' precincts (' +
        Math.round((c.precincts / c.totalPrecincts) * 100) +
        '%)'
    );

    // We want question to be yes first, but ordering the candidates
    // is a key part to determining the winner, so doing this here,
    // but, maybe should be universal
    c.candidates = _.sortBy(c.candidates, a => {
      if (c.question) {
        return a.last.toLowerCase() === 'no' ? 'zzzzzz' : 'aaaaaa';
      }
    });

    // A bit of a hack.  Ranked choice might not have ranks reporting
    // even though votes are being cast.  So, if we have some precincts
    // reporting, but there are not votes for a specific rank
    let emptyRanks;
    if (c.candidates && c.candidates.length && c.ranked && c.precincts) {
      emptyRanks = _.filter(
        _.map(c.candidates[0].ranks, r => {
          let votes = _.sumBy(c.candidates, c => {
            return _.find(c.ranks, { rankedChoice: r.rankedChoice }).votes;
          });
          return votes ? null : r.rankedChoice;
        })
      );
    }

    // Candidates
    _.each(c.candidates, candidate => {
      if (candidate.writeIn) {
        return;
      }

      if (c.ranked) {
        lines.push(
          tags.ranked +
            (candidate.winner ? '<saxo:ch value="226 136 154"/>' : ' ') +
            '\t' +
            display(candidate) +
            (candidate.incumbent ? ' (i)' : '') +
            '\t' +
            (candidate.ranks[0].votes
              ? utility.formatNumber(candidate.ranks[0].votes, 0)
              : emptyRanks &&
                ~emptyRanks.indexOf(candidate.ranks[0].rankedChoice)
                ? '-'
                : 0) +
            '\t' +
            (candidate.ranks[0].percent
              ? Math.round(candidate.ranks[0].percent) + '%'
              : emptyRanks &&
                ~emptyRanks.indexOf(candidate.ranks[0].rankedChoice)
                ? '-'
                : '0%') +
            '\t' +
            (candidate.ranks[1].votes
              ? utility.formatNumber(candidate.ranks[1].votes, 0)
              : emptyRanks &&
                ~emptyRanks.indexOf(candidate.ranks[1].rankedChoice)
                ? '-'
                : 0) +
            '\t' +
            (candidate.ranks[1].percent
              ? Math.round(candidate.ranks[1].percent) + '%'
              : emptyRanks &&
                ~emptyRanks.indexOf(candidate.ranks[1].rankedChoice)
                ? '-'
                : '0%') +
            '\t' +
            (candidate.ranks[2].votes
              ? utility.formatNumber(candidate.ranks[2].votes, 0)
              : emptyRanks &&
                ~emptyRanks.indexOf(candidate.ranks[2].rankedChoice)
                ? '-'
                : 0) +
            '\t' +
            (candidate.ranks[2].percent
              ? Math.round(candidate.ranks[2].percent) + '%'
              : emptyRanks &&
                ~emptyRanks.indexOf(candidate.ranks[2].rankedChoice)
                ? '-'
                : '0%') +
            '\t' +
            (candidate.votes ? utility.formatNumber(candidate.votes, 0) : '-') +
            '\t' +
            (candidate.votes ? Math.round(candidate.percent) + '%' : '-')
        );
      }
      else {
        lines.push(
          (c.question && candidate.last.toLowerCase() === 'no'
            ? tags.candidateNo
            : tags.candidate) +
            // Still unsure to mark winner when close
            //(candidate.winner && (!c.close || (c.called && c.close))
            (candidate.winner ? '<saxo:ch value="226 136 154"/>' : ' ') +
            '\t' +
            display(candidate) +
            (candidate.incumbent ? ' (i)' : '') +
            '\t' +
            (candidate.votes ? utility.formatNumber(candidate.votes, 0) : 0) +
            '\t' +
            (candidate.percent ? Math.round(candidate.percent) : '0') +
            '%'
          //(ci === 0 ? '%' : '')
        );
      }
    });

    previous = c;
  });

  // Output text
  return _.flatten(lines).join('\r\n');
}

// Display name for candidate
const maxNameLength = 22;
function display(candidate) {
  let name = _
    .filter([
      candidate.title,
      candidate.prefix,
      candidate.first,
      candidate.middle,
      candidate.nick ? '"' + candidate.nick + '"' : null,
      candidate.last,
      candidate.suffix ? ', ' + candidate.suffix : ''
    ])
    .join(' ');

  if (name.length > maxNameLength) {
    name = _
      .filter([
        candidate.first ? candidate.first[0] + '.' : '',
        candidate.middle ? candidate.middle[0] + '.' : '',
        candidate.last,
        candidate.suffix ? ', ' + candidate.suffix : ''
      ])
      .join(' ');
  }

  if (name.length > maxNameLength) {
    name = candidate.last;
  }

  return name;
}

// Export
module.exports = toPrint;
