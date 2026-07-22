import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "douyinLM｜在收藏夹中 VibeCoding",
  description: "把收藏的视频，编译成可以直接行动的成果。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
