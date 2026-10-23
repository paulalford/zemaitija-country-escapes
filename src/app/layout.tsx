import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Žemaitija Country Escapes — Portfolio Demo",
  description: "Fictional accommodation booking platform portfolio demonstration.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
