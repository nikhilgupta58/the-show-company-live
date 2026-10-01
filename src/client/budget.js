// Indian digit grouping for the budget field: 150000 -> 1,50,000 (last three digits, then pairs).
// Same result as production's formatBudget (site-contract.md §6); the submitted value is the
// formatted string, as before. Check: `node src/client/budget.check.mjs`.

/**
 * @param {string} value     what is in the field now
 * @param {string} [previous] what was in it before this keystroke
 * @returns {string}
 */
export function formatBudget(value, previous = '') {
  const raw = value.replace(/[^0-9]/g, '');
  if (!raw) return '';
  // While deleting down to three digits or fewer, show the bare digits.
  if (value.length < previous.length && raw.length <= 3) return raw;
  const lastThree = raw.slice(-3);
  const rest = raw.slice(0, -3);
  return rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
}
