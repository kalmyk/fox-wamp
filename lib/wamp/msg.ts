import { errorCodes } from '../realm_error';

export const errorMessages: Record<number | string, string> = {};

errorMessages[errorCodes.ERROR_NO_SUCH_PROCEDURE] = 'wamp.error.no_such_procedure';
errorMessages[errorCodes.ERROR_NO_SUCH_REGISTRATION] = 'wamp.error.no_such_registration';
errorMessages[errorCodes.ERROR_AUTHORIZATION_FAILED] = 'wamp.error.authorization_failed';
errorMessages[errorCodes.ERROR_NOT_AUTHORIZED] = 'wamp.error.not_authorized';
errorMessages[errorCodes.ERROR_INVALID_PAYLOAD] = 'wamp.error.invalid_payload';
errorMessages[errorCodes.ERROR_INVALID_URI] = 'wamp.error.invalid_uri';
errorMessages[errorCodes.ERROR_INVALID_ARGUMENT] = 'wamp.error.invalid_argument';
errorMessages[errorCodes.ERROR_OPTION_NOT_SUPPORTED] = 'wamp.error.option_not_supported';
errorMessages[errorCodes.ERROR_CALLEE_FAILURE] = 'wamp.error.callee_failure';

export function wampErrorCode(errorCode: number | string): string {
  return errorMessages[errorCode] ? errorMessages[errorCode] : String(errorCode);
}
