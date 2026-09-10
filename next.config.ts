import type { NextConfig } from "next";

// DEV_BYPASS_AUTH must be impossible to enable in a production build (spec §9).
if (process.env.NODE_ENV === "production" && process.env.DEV_BYPASS_AUTH === "true") {
  throw new Error("DEV_BYPASS_AUTH=true is not allowed in a production build");
}

export default {} satisfies NextConfig;
