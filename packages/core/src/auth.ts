import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "@infradeck/db";
export const auth = betterAuth({
  appName: "InfraDeck",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
  },
  rateLimit: { enabled: true, window: 60, max: 20, storage: "database" },
  advanced: {
    useSecureCookies: process.env.BETTER_AUTH_URL?.startsWith("https://"),
  },
  plugins: [nextCookies()],
});
