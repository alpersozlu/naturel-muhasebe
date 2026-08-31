import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { routing } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

const PUBLIC_PATHS = ["/login"];
const LOCALE_RE = /^\/(tr|en)(\/|$)/;

function stripLocale(pathname: string): string {
  const m = pathname.match(LOCALE_RE);
  return m ? pathname.replace(m[0], "/") : pathname;
}

function isPublicPath(pathname: string): boolean {
  const noLocale = stripLocale(pathname);
  return PUBLIC_PATHS.some((p) => noLocale === p || noLocale.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const intlResponse = intlMiddleware(request);

  // Auth env yoksa (dev/credential öncesi) sadece intl çalışsın
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return intlResponse;
  }

  const response = intlResponse ?? NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = isPublicPath(pathname);

  // Korumalı route + login yok → /login'e yönlendir
  if (!user && !isPublic) {
    const locale = pathname.match(LOCALE_RE)?.[1] ?? routing.defaultLocale;
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url));
  }

  // Login'deyken zaten girişliyse → /admin'e
  if (user && isPublic) {
    const locale = pathname.match(LOCALE_RE)?.[1] ?? routing.defaultLocale;
    return NextResponse.redirect(new URL(`/${locale}/admin`, request.url));
  }

  // Path'i header'a yaz ki AppLayout role-based redirect yapabilsin.
  // AppLayout `headers()` ile İSTEK başlıklarını okur; yanıt başlığına yazmak
  // tek başına yeterli değil. İstek başlığını da geçir — okunamazsa layout
  // yolu "/" sanıp admin-dışı kullanıcıyı sonsuz yönlendirmeye sokabilir.
  response.headers.set("x-pathname", pathname);

  // intl bir yönlendirme döndürdüyse ona DOKUNMA — ezersek locale
  // yönlendirmesi kırılır.
  if (response.status >= 300 && response.status < 400) return response;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  const withPath = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.forEach((v, k) => withPath.headers.set(k, v));
  for (const c of response.cookies.getAll()) withPath.cookies.set(c);
  return withPath;
}

export const config = {
  matcher: [
    // intl + auth her şeyde, ama _next, api, static dosyalar hariç
    "/((?!api|_next|_vercel|.*\\..*).*)",
  ],
};
