import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // This app lives inside a home directory that has its own lockfile; pin the root
  // so the build traces files from here and not from one level up.
  outputFileTracingRoot: here,
};
