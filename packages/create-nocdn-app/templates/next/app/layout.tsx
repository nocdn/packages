import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import localFont from "next/font/local"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const ioskeleyMono = localFont({
  src: [
    { path: "./fonts/IoskeleyMono-Light.woff2", weight: "300" },
    { path: "./fonts/IoskeleyMono-Regular.woff2", weight: "400" },
    { path: "./fonts/IoskeleyMono-Medium.woff2", weight: "500" },
    { path: "./fonts/IoskeleyMono-SemiBold.woff2", weight: "600" },
    { path: "./fonts/IoskeleyMono-Bold.woff2", weight: "700" },
    { path: "./fonts/IoskeleyMono-ExtraBold.woff2", weight: "800" },
  ],
  variable: "--font-ioskeley-mono",
  preload: false,
})

const isDevelopment = process.env.NODE_ENV === "development"

const baseTitle = "{{project-name}}"

export const metadata: Metadata = {
  title: isDevelopment ? `${baseTitle} (dev)` : baseTitle,
  // prettier-ignore
  description: "{{project-description-escaped}}",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${ioskeleyMono.variable}`}
    >
      <body className="bg-background antialiased">{children}</body>
    </html>
  )
}
