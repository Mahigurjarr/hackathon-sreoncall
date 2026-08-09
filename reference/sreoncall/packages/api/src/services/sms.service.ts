/**
 * SMS service — delegates to Plivo.
 *
 * All existing callers import `sendSms` from this module,
 * so swapping the implementation here requires zero import changes.
 */

export { sendSms } from './plivo.service';
