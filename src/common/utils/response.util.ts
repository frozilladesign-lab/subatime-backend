export function okResponse<T>(data: T, message = 'Success'): {
  message: string;
  data: T;
} {
  return {
    message,
    data,
  };
}
