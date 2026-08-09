// promptfoo custom assertion: the model output parses as valid LogQL, using the SAME Lezer
// grammar the API's query-validation.service uses (so eval + runtime agree on "valid").
const { parser } = require('@grafana/lezer-logql');

module.exports = (output) => {
  // The prompt returns a JSON object {logql, explanation}; tolerate raw string too.
  let q = output;
  try {
    const obj = JSON.parse(output);
    if (obj && typeof obj.logql === 'string') q = obj.logql;
  } catch {
    /* not JSON — assert on the raw string */
  }
  const tree = parser.parse(q);
  const cursor = tree.cursor();
  do {
    if (cursor.type.isError) {
      return { pass: false, score: 0, reason: `LogQL parse error near position ${cursor.from}: ${q}` };
    }
  } while (cursor.next());
  return { pass: true, score: 1, reason: 'valid LogQL' };
};
