import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // Supabase Storage signed URLs
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
  experimental: {
    // pdf-parse / pdfjs-dist stay external: pdf.js is loaded on demand from
    // node_modules (see services/payroll/performance.ts → loadPdfParse).
    serverComponentsExternalPackages: ["sharp", "pdf-parse", "pdfjs-dist"],
  },
};

export default withNextIntl(nextConfig);
