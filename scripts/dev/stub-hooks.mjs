// Loader hook for one-off local scripts: Next's request-scoped modules do not
// exist outside a request, so "next/headers" resolves to a small stub.
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
const stub = pathToFileURL(new URL("./stub-next-headers.cjs", import.meta.url).pathname).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: stub, shortCircuit: true, format: "commonjs" };
    return nextResolve(specifier, context);
  },
});
