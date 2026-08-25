import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/__tests__/**/*.test.ts"],
		testTimeout: 10000,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.d.ts", "src/index.ts", "src/__tests__/**"],
			reportsDirectory: "coverage",
			reporter: ["text", "lcov", "html"],
			thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
		},
	},
});
