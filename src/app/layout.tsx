import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: { default: "Tasklane", template: "%s · Tasklane" },
  description: "Project and task management for teams that ship.",
  applicationName: "Tasklane",
  openGraph: { type: "website", siteName: "Tasklane", title: "Tasklane", description: "Project and task management for teams that ship." },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1d2125" },
  ],
};

// Runs before first paint so a saved light/dark choice never flashes the wrong theme.
const THEME_BOOT = `try{var t=localStorage.getItem("tl-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
