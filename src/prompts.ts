import type { GetPromptResult, Prompt, PromptArgument } from "@modelcontextprotocol/sdk/types.js";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { log } from "./utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default directory containing prompt definition files, relative to the package root. */
export const DEFAULT_PROMPTS_DIR = join(__dirname, "..", "prompts");

/**
 * A prompt argument definition as read from a prompt file.
 * Extends the MCP argument with an optional default value used when the client omits the argument.
 */
type PromptArgumentDefinition = PromptArgument & {
	default?: string;
};

/**
 * A prompt definition as read from a JSON file in the prompts directory.
 * The template is the user-message text; `{argName}` placeholders are substituted at get time.
 */
export type PromptDefinition = Omit<Prompt, "arguments"> & {
	arguments?: PromptArgumentDefinition[];
	template: string;
};

/**
 * Loads prompt definitions from all JSON files in a directory.
 * Invalid files are skipped with a warning; a missing directory yields an empty list.
 * @param dir - Directory to read prompt files from; defaults to the package's prompts folder.
 * @returns The loaded prompt definitions, sorted by name.
 */
export function loadPrompts(dir: string = DEFAULT_PROMPTS_DIR): PromptDefinition[] {
	let files: string[];
	try {
		files = readdirSync(dir).filter((file) => file.endsWith(".json"));
	} catch {
		log.warn(`Prompts directory not found: ${dir}`);
		return [];
	}

	const prompts: PromptDefinition[] = [];
	for (const file of files) {
		const path = join(dir, file);
		try {
			const parsed = JSON.parse(readFileSync(path, "utf-8")) as PromptDefinition;
			if (typeof parsed.name !== "string" || typeof parsed.template !== "string") {
				log.warn(`Skipping invalid prompt file (missing name or template): ${path}`);
				continue;
			}
			prompts.push(parsed);
		} catch (error) {
			log.warn(`Skipping unreadable prompt file: ${path}`, error);
		}
	}

	prompts.sort((a, b) => a.name.localeCompare(b.name));
	log.info(`Loaded ${prompts.length} prompt(s) from ${dir}`);
	return prompts;
}

/**
 * Converts a prompt definition to its MCP descriptor (without the template or argument defaults).
 * @param definition - The prompt definition to convert.
 * @returns The MCP prompt descriptor.
 */
export function toPromptDescriptor(definition: PromptDefinition): Prompt {
	return {
		name: definition.name,
		title: definition.title,
		description: definition.description,
		arguments: definition.arguments?.map((argument) => ({
			name: argument.name,
			description: argument.description,
			required: argument.required,
		})),
	};
}

/**
 * Renders a prompt definition into an MCP get-prompt result, substituting `{argName}`
 * placeholders with provided argument values (or the argument's default when omitted).
 * @param definition - The prompt definition to render.
 * @param args - Argument values provided by the client.
 * @returns The rendered prompt result.
 */
export function renderPrompt(definition: PromptDefinition, args?: Record<string, string>): GetPromptResult {
	let text = definition.template;
	for (const argument of definition.arguments ?? []) {
		const value = args?.[argument.name] ?? argument.default ?? "";
		text = text.replaceAll(`{${argument.name}}`, value);
	}

	return {
		description: definition.description,
		messages: [
			{
				role: "user",
				content: { type: "text", text },
			},
		],
	};
}
