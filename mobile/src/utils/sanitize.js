/**
 * Client-side input sanitisation.
 * Strips shell metacharacters before sending queries to the backend.
 * The backend also sanitises — this is a defence-in-depth layer.
 */
const SHELL_META = /[&|;$><`!{}\\]/g;

export function sanitize(input) {
  if (typeof input !== 'string') return '';
  return input.replace(SHELL_META, '').trim().slice(0, 200);
}
