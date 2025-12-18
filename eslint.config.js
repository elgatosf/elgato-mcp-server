import { config } from "@elgato/eslint-config";

export default [
	...config.recommended,
	{
		ignores: ["**/*.test.ts", "**/*.test.js", "**/__tests__/**", "**/tests/**"],
	},
	{
		rules: {
			"jsdoc/require-jsdoc": [
				"warn",
				{
					publicOnly: true,
					require: {
						FunctionDeclaration: true,
						MethodDefinition: true,
						ClassDeclaration: true,
						ArrowFunctionExpression: false,
						FunctionExpression: false,
					},
					contexts: ["ExportNamedDeclaration", "TSInterfaceDeclaration", "TSTypeAliasDeclaration"],
					checkConstructors: false,
					checkGetters: false,
					checkSetters: false,
				},
			],
			"@typescript-eslint/explicit-member-accessibility": "off",
		},
	},
];
