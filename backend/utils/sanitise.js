/**
 * Input sanitisation — strips shell metacharacters before they reach flix-cli.
 * Even though we use spawn() with arg arrays (safe by default), we sanitise
 * as a defence-in-depth measure.
 */
const SHELL_META = /[&|;$><`!{}\\]/g;

/**
 * @param {string} input
 * @returns {string} cleaned string safe to pass as a CLI argument
 */
function sanitiseInput(input) {
  if (typeof input !== 'string') throw new TypeError('Input must be a string');
  return input.replace(SHELL_META, '').trim().slice(0, 200); // cap at 200 chars
}

module.exports = { sanitiseInput };
