export type Success<T> = Readonly<{ ok: true; value: T }>;
export type Failure = Readonly<{ ok: false; error: string }>;
export type Result<T> = Success<T> | Failure;

export const success = <T>(value: T): Success<T> => ({ ok: true, value });
export const failure = (error: string): Failure => ({ ok: false, error });
