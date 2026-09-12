/**
 * Marks a function body that has not been written yet.
 *
 * Returns `never`, so TypeScript accepts it as the body of a function with any
 * return type, and the compiler will still flag the signature if it is wrong.
 * Prefer this over returning a fake value: a stub that silently returns zero is
 * far harder to notice than one that stops.
 */
export function notImplemented(what: string): never {
  throw new Error(`Not implemented yet: ${what}`);
}
