// Log classifications, not exception bodies, provider responses or credentials.
const codes = new Set(['ADMISSION_UNCERTAIN', 'EACCES', 'ENOENT', 'ENOSPC', 'ELOCKED', 'ECOMPROMISED',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE']);
export function diagnosticCode(error) {
  if (codes.has(error?.code)) return error.code;
  const status = error?.status || error?.response?.status || error?.data?.statusCode;
  if (Number.isInteger(status) && status >= 100 && status <= 599) return `HTTP_${status}`;
  return 'INTERNAL_OR_TRANSPORT_ERROR';
}
