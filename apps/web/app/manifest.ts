import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.name,
    description:
      "接住聊天里重要的人和未完的事，让下一次交流接得上。",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f1ed",
    theme_color: "#d84a35",
    icons: [
      {
        src: "/icon",
        sizes: "32x32",
        type: "image/png",
      },
    ],
  };
}
