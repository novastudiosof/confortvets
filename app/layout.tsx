import type { Metadata, Viewport } from "next";

import "./globals.css";
import { PRODUCT_NAME, PRODUCT_SLOGAN } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description: `${PRODUCT_NAME} — ${PRODUCT_SLOGAN} Gestión para veterinarios independientes.`,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050816",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
