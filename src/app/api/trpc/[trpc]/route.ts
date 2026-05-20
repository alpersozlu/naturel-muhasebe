import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/routers/_app";
import { createContext } from "@/server/trpc/context";

// OCR async olduğu için bu route normalde hızlıdır, ama upload + storage
// yazma için biraz pay bırakıyoruz. Vercel Pro plan'da max 60s'e çıkarabilir.
export const maxDuration = 30;

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
    onError({ error, path }) {
      if (process.env.NODE_ENV !== "production") {
        console.error(`tRPC error on ${path}:`, error);
      }
    },
  });

export { handler as GET, handler as POST };
