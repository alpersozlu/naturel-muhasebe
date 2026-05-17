import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DocuFlow TR",
  description: "Perakende zinciri günlük iç muhasebe sistemi",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
