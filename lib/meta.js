/**
 * Meta data class
 */

// Dependencies
const _ = require('lodash');
const Base = require('./base.js');
const utility = require('./utility.js');

// Meta class
class Meta extends Base {
  constructor(input, properties = {}, options = {}, election) {
    super(options);

    // Attach election
    if (election) {
      this.election = election;
    }

    // Update properties.  Should included set, i.e. "districts", and type,
    // i.e. "precinct", and election object.
    if (_.isPlainObject(properties)) {
      this.set('', properties, { update: false, validate: false });
    }

    // Check type
    if (_.isString(input)) {
      this.set('', this.parseSoS(input, properties));
    }
    else if (_.isPlainObject(input)) {
      this.set('', input);
    }
    else if (input) {
      throw new Error('Input provided was not string or object.');
    }
  }

  // On Update
  update() {
    this.updateNames();
  }

  // Update names, specifically to help with matching contests.
  updateNames() {
    let name = this.get('name');
    if (name) {
      name = name.replace(/(^|[^a-zA-Z0-9])(st|saint|st\.)\s/i, '$1St. ');
      name = name.replace(/(^|[^a-zA-Z0-9])(isd|ssd)\s/i, '$1$2 ');
      name = name.replace(/\stwp($|\s)/i, ' Township$1');
      name = name.replace(/\s+/g, ' ');
      this.set('name', name.trim());
    }
  }

  // Parse a row of data from the SoS
  parseSoS(row, properties) {
    row = row.split(';');

    if (properties.set === 'districts') {
      return this.parseSoSDistricts(row, properties.type);
    }
    else if (properties.set === 'questions') {
      return this.parseSoSQuestions(row, properties.type);
    }
  }

  // Parse question data
  parseSoSQuestions(row, type) {
    let parsed = {};

    (parsed.county = utility.padLeft(utility.raw(row[0]), 2)),
      (parsed.contest = utility.padLeft(utility.raw(row[1]), 4)),
      (parsed.local = utility.padLeft(utility.raw(row[2]), 5));
    parsed.school = utility.padLeft(utility.raw(row[3]), 4);

    // Question number, though it is actually the description "office"
    parsed.contestRaw = utility.raw(row[4]);
    parsed.questionTitle = utility.titleCase(
      utility
        .raw(row[5])
        .replace(/[^\w\s]/g, ' ')
        .toLowerCase()
    );

    // BY VOTING "YES" ON THIS BALLOT QUESTION, YOU ARE VOTING FOR A PROPERTY TAX INCREASE.
    // BY VOTING "YES" ON THIS BALLOT QUESTION, YOU ARE VOTING TO EXTEND AN EXISTING PROPERTY TAX REFERENDUM THAT IS SCHEDULED TO EXPIRE.
    // BY VOTING "YES" ON THIS BALLOT QUESTION, YOU ARE VOTING FOR A PROPERTY TAX INCREASE TO PAY THE PRINCIPAL OF, THE PREMIUM, IF ANY, AND THE INTEREST ON THE BONDS.
    // BY VOTING "YES" ON THIS BALLOT QUESTION, YOU ARE VOTING FOR A PROPERTY TAX INCREASE.  PASSAGE OF THIS REFERENDUM WILL RESULT IN AN INCREASE IN YOUR PROPERTY TAXES.
    // BY VOTING "YES" ON THIS BALLOT QUESTION, YOU ARE VOTING TO EXTEND AN EXISTING PROPERTY TAX REFERENDUM THAT IS SCHEDULED TO EXPIRE
    // BY VOTING "YES" ON THIS BALLOT QUESTION, YOU
    //
    // ARE VOTING FOR A PROPERTY TAX INCREASE.
    // BY VOTING "YES" ON THIS BALLOT QUESTION, YOU ARE VOTING TO RENEW AN EXISTING CAPITAL PROJECTS REFERENDUM THAT IS SCHEDULED TO EXPIRE.
    // PASSAGE OF THIS REFERENDUM WILL RESULT IN AN INCREASE IN YOUR PROPERTY TAXES.
    // PASSAGE OF THIS REFERENDUM EXTENDS AN EXISTING OPERATING REFERENDUM AT THE SAME AMOUNT PER PUPIL AS IN THE PREVIOUS YEAR.
    parsed.questionText = utility
      .raw(row[6])
      .replace(/&bull\^/gi, '')
      .replace(/\^\s/gi, '; ')
      .replace(/\n/g, '  ')
      .replace(/\s{3,}/g, '  ')
      .trim()
      .replace(/(by\s+voting\s+|passage\s+of\s+this\s+ref).*$/i, '')
      .trim();

    // Attempt to make district ID
    parsed.district =
      parsed.county === '88'
        ? 'MN'
        : parsed.school
          ? parsed.school
          : parsed.local
            ? parsed.local
            : parsed.county ? parsed.county : undefined;

    // Attempt to determine type
    parsed.type =
      parsed.county === '88'
        ? 'amendement'
        : parsed.school
          ? 'school'
          : parsed.local ? 'local' : parsed.county ? 'county' : type;

    // Attempt to make id that matches contest
    parsed.id = utility.makeID([
      this.election.get('id'),
      parsed.type,
      parsed.county,
      parsed.district,
      parsed.contest
    ]);
    parsed.contestID = utility.makeID([
      this.election.get('id'),
      parsed.type,
      parsed.district,
      parsed.contest
    ]);

    return parsed;
  }

  // Parse districts meta data
  parseSoSDistricts(row, type) {
    let parsed = {};

    if (!type) {
      throw new Error('type not provided to parseSoSDistricts.');
    }

    // For some reference
    // http://electionresults.sos.state.mn.us/Select/DownloadFileFormats/6
    if (type === 'county') {
      parsed.county = utility.padLeft(utility.raw(row[0]), 2);
      parsed.name = utility.titleCase(utility.raw(row[1]).toLowerCase());
      parsed.precincts = utility.raw(row[2], 'int');

      parsed.id = utility.makeID([
        this.election.get('id'),
        type,
        parsed.county
      ]);
      parsed.contestMatch = utility.makeID([
        this.election.get('id'),
        type,
        parsed.county
      ]);
    }
    else if (type === 'school') {
      parsed.school = utility.padLeft(utility.raw(row[0]), 4);
      parsed.name = utility
        .titleCase(utility.raw(row[1]).toLowerCase())
        .replace(/(area school district|school district)/i, '')
        .trim();
      parsed.county = utility.padLeft(utility.raw(row[2]), 2);
      parsed.countyName = utility.raw(row[3]);

      // Wonderfully so, Minneapolis and Aitkin share the
      // same ID, so we assign Minneapolis a hopefully unique
      // alternative
      if (parsed.school === '0001' && parsed.name.match(/minneapolis/i)) {
        parsed.school = '9991';
      }

      // A school code can be in multiple counties, though
      // a contest ID doen't care
      parsed.id = utility.makeID([
        this.election.get('id'),
        type,
        parsed.county,
        parsed.school
      ]);
      parsed.contestMatch = utility.makeID([
        this.election.get('id'),
        type,
        parsed.school
      ]);
    }
    else if (type === 'local') {
      parsed.county = utility.padLeft(utility.raw(row[0]), 2);
      parsed.countyName = utility.raw(row[1]);
      // FIPS code
      parsed.local = utility.padLeft(utility.raw(row[2]), 5);
      parsed.name = utility.titleCase(utility.raw(row[3]).toLowerCase());

      // A city (local) can be in multiple counties, though
      // a contest ID doen't care
      parsed.id = utility.makeID([
        this.election.get('id'),
        type,
        parsed.county,
        parsed.local
      ]);
      parsed.contestMatch = utility.makeID([
        this.election.get('id'),
        type,
        parsed.local
      ]);
    }
    else if (type === 'precinct') {
      parsed.county = utility.padLeft(utility.raw(row[0]), 2);
      parsed.precinct = utility.padLeft(utility.raw(row[1]), 4);
      parsed.name = utility.titleCase(utility.raw(row[2]).toLowerCase());
      parsed.congress = utility.raw(row[3]);
      parsed.mnHouse = utility.padLeft(utility.raw(row[4]), 3);
      parsed.countyCommissioner = utility.padLeft(utility.raw(row[5]), 2);
      parsed.judicial = utility.padLeft(utility.raw(row[6]), 2);
      parsed.soilWater = utility.padLeft(utility.raw(row[7]), 4);
      // FIPS code
      parsed.local = utility.padLeft(utility.raw(row[8]), 5);
      (parsed.school = utility.padLeft(utility.raw(row[9]), 4)),
        // MN Sentate is house without letter
        (parsed.mnSenate = parsed.mnHouse
          ? parsed.mnHouse.replace(/[a-z]+/, '')
          : undefined);

      // Precinct is unique to county or school
      parsed.id = utility.makeID([
        this.election.get('id'),
        parsed.school ? type + '-school' : type,
        parsed.school ? parsed.school : parsed.county,
        parsed.precinct
      ]);
    }

    return parsed;
  }
}

// Export
module.exports = Meta;
