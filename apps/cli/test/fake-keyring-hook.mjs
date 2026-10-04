/** Resolution hook mapping "@napi-rs/keyring" to the test double module. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@napi-rs/keyring") {
    return {
      shortCircuit: true,
      url: new URL("./fake-keyring-module.mjs", import.meta.url).href,
    };
  }
  return nextResolve(specifier, context);
}
