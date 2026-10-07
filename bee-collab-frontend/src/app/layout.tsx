import type { Metadata } from "next";
import "./globals.css";
import WakeServer from "./WakeServer";
import { LanguageProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "BeeCollab | Seamless Collaboration",
  description: "Connect and collaborate with your team.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: some browser extensions inject attributes
          (e.g. bis_register, __processed_*) onto <body> before React hydrates,
          which would otherwise log a harmless hydration mismatch warning. */}
      <body suppressHydrationWarning>
        <LanguageProvider>
          <WakeServer />
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
