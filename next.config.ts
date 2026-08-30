import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the Daytona SDK reaches for form-data through a dynamic require, which the bundler
  // cannot follow. Leaving it external keeps file uploads to the sandbox working.
  // CLAUDE.md here is the project journal, not a generated pointer
  agentRules: false,
  // it parks itself on top of the attach button, and this gets demoed on localhost
  devIndicators: false,
  serverExternalPackages: ["@daytonaio/sdk", "@daytona/api-client"],
};

export default nextConfig;
