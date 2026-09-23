import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/m",
    name: "MIGRA 移动工作台",
    short_name: "MIGRA",
    description: "查看提醒、查询订单并处理紧急业务事项",
    start_url: "/m",
    scope: "/m",
    display: "standalone",
    background_color: "#f7f9f9",
    theme_color: "#0f766e",
    orientation: "portrait-primary",
    lang: "zh-CN",
    icons: [
      {
        src: "/icons/migra-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/migra-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/migra-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
