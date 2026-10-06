// Loader hook for one-off local scripts: Next's request-scoped modules do not
// exist outside a request, so "next/headers" resolves to a small stub.
// (href doğrudan kullanılır: pathname → pathToFileURL yolu ikinci kez
// kodluyordu ve boşluk/Türkçe harf içeren klasörde dosya bulunamıyordu.)
import { registerHooks } from "node:module";
const stub = new URL("./stub-next-headers.cjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: stub, shortCircuit: true, format: "commonjs" };
    return nextResolve(specifier, context);
  },
});
