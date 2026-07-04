import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "drizzle/**",
      "workers/**/node_modules/**",
      "workers/**/.wrangler/**",
      "data/**",
    ],
  },
];

export default eslintConfig;
