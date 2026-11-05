import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "exceljs",
    "bullmq",
  ],
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};
export default config;
