export declare const errorCodes: {
  ERROR_DEFER_NOT_FOUND: number;
  ERROR_NO_SUCH_PROCEDURE: number;
  ERROR_NO_SUCH_REGISTRATION: number;
  ERROR_HEADER_IS_NOT_COMPLETED: number;
  ERROR_AUTHORIZATION_FAILED: number;
  ERROR_NOT_AUTHORIZED: number;
  ERROR_INVALID_PAYLOAD: number;
  ERROR_INVALID_URI: number;
  ERROR_INVALID_ARGUMENT: number;
  ERROR_CALLEE_FAILURE: string;
};

export declare class RealmError extends Error {
  requestId: string | number;
  code: string | number;
  constructor(requestId: string | number, code: string | number, message?: string);
}
