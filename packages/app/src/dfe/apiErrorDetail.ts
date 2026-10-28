// ky's `beforeError` hook: a 4xx error carries the response body's reason as its
// message, where ky's own is only the status line. Other errors pass through.
//
// This is a NEW file - it does not modify any upstream HyperDX files.

import type { HTTPError } from 'ky';

import { getApiErrorMessage } from '@/utils/apiErrors';

const NO_DETAIL = '';

// The fork's own refusals answer `{ error }` where upstream answers `{ message }`.
async function errorFieldDetail(error: HTTPError): Promise<string> {
  try {
    const body: unknown = await error.response.clone().json();
    if (
      body != null &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
    ) {
      return body.error;
    }
  } catch {
    // Not JSON, so the body carries no reason.
  }
  return NO_DETAIL;
}

export async function dfeApiErrorDetail(error: HTTPError): Promise<HTTPError> {
  const status = error.response?.status;
  if (status == null || status < 400 || status >= 500) {
    return error;
  }
  const detail =
    (await getApiErrorMessage(
      { response: error.response.clone() },
      NO_DETAIL,
    )) || (await errorFieldDetail(error));
  if (detail) {
    error.message = detail;
  }
  return error;
}
