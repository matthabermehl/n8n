import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { CompatibilityCallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { Toolkit } from 'langchain/agents';
import { DynamicStructuredTool, type DynamicStructuredToolInput } from 'langchain/tools';
import {
	createResultError,
	createResultOk,
	type IDataObject,
	type IExecuteFunctions,
	type Result,
	NodeOperationError, // Import NodeOperationError
} from 'n8n-workflow';
import { type ZodTypeAny } from 'zod';
import { convertJsonSchemaToZod, UnsupportedSchemaError } from '@utils/schemaParsing';

import type { McpAuthenticationOption, McpTool, McpToolIncludeMode } from './types';

export async function getAllTools(client: Client, cursor?: string): Promise<McpTool[]> {
	const response = await client.listTools({ cursor }); // Get the whole response object
	// Ensure response.tools is an array, default to empty array if not, or if response.tools is undefined
	const currentTools = Array.isArray(response.tools) ? response.tools : [];
	const nextCursor = response.nextCursor;

	if (nextCursor) {
		// Recursively get tools from the next page
		const nextTools = await getAllTools(client, nextCursor);
		// Concatenate current page's tools (now guaranteed to be an array) with next page's tools
		return (currentTools as McpTool[]).concat(nextTools);
	}

	// Return current page's tools (guaranteed to be an array)
	return currentTools as McpTool[];
}

export function getSelectedTools({
	mode,
	includeTools,
	excludeTools,
	tools,
}: {
	mode: McpToolIncludeMode;
	includeTools?: string[];
	excludeTools?: string[];
	tools: McpTool[];
}) {
	switch (mode) {
		case 'selected': {
			if (!includeTools?.length) return tools;
			const include = new Set(includeTools);
			return tools.filter((tool) => include.has(tool.name));
		}
		case 'except': {
			const except = new Set(excludeTools ?? []);
			return tools.filter((tool) => !except.has(tool.name));
		}
		case 'all':
		default:
			return tools;
	}
}

export const getErrorDescriptionFromToolCall = (result: unknown): string | undefined => {
	if (result && typeof result === 'object') {
		if ('content' in result && Array.isArray(result.content)) {
			const errorMessage = (result.content as Array<{ type: 'text'; text: string }>).find(
				(content) => content && typeof content === 'object' && typeof content.text === 'string',
			)?.text;
			return errorMessage;
		} else if ('toolResult' in result && typeof result.toolResult === 'string') {
			return result.toolResult;
		}
		if ('message' in result && typeof result.message === 'string') {
			return result.message;
		}
	}

	return undefined;
};

export const createCallTool =
	(name: string, client: Client, onError: (error: string | undefined) => void) =>
	async (args: IDataObject) => {
		let result: Awaited<ReturnType<Client['callTool']>>;
		try {
			result = await client.callTool({ name, arguments: args }, CompatibilityCallToolResultSchema);
		} catch (error) {
			return onError(getErrorDescriptionFromToolCall(error));
		}

		if (result.isError) {
			return onError(getErrorDescriptionFromToolCall(result));
		}

		if (result.toolResult !== undefined) {
			return result.toolResult;
		}

		if (result.content !== undefined) {
			return result.content;
		}

		return result;
	};

export function mcpToolToDynamicTool(
	tool: McpTool,
	onCallTool: DynamicStructuredToolInput['func'],
	// Assuming logger is available or can be passed, if not, console.warn can be used by the worker.
	// For this subtask, direct error throwing is the primary goal.
	// A proper logger would be obtained via `this.logger` in the node's context,
	// but utils files don't have direct access. For now, console.warn is acceptable if logging is done.
	// The plan is to throw a NodeOperationError, which will be handled by the node execution.
) {
	let zodSchema: ZodTypeAny;
	try {
		zodSchema = convertJsonSchemaToZod(tool.inputSchema);

		// Check if the conversion resulted in z.any() when the original schema was not trivial
		const isActuallyAny = zodSchema._def.typeName === 'ZodAny';
		const isTrivialOriginalSchema =
			!tool.inputSchema ||
			Object.keys(tool.inputSchema).length === 0 ||
			(typeof tool.inputSchema === 'boolean' && tool.inputSchema === true);

		if (isActuallyAny && !isTrivialOriginalSchema) {
			throw new UnsupportedSchemaError(
				`Schema for tool "${tool.name}" was converted to z.any(), indicating an unsupported feature (e.g., 'default' values) or an empty schema that couldn't be processed into a stricter type. Original schema: ${JSON.stringify(tool.inputSchema)}`,
			);
		}
	} catch (error) {
		// console.warn(`[McpClientTool] Failed to convert JSON schema to Zod for tool "${tool.name}". Schema: ${JSON.stringify(tool.inputSchema)}. Error: ${error.message}`);
		if (error instanceof UnsupportedSchemaError) {
			// Logging would ideally happen in the node context using this.logger
			// For now, the error thrown will provide the info.
			throw new NodeOperationError(
				// We don't have `this.getNode()` here.
				// The error will be caught by the node that calls this utility.
				// For now, create a generic NodeOperationError.
				// A better approach might be to let McpClientTool.node.ts call this and handle errors.
				{
					name: 'McpClientTool',
					type: 'mcpClientTool',
					typeVersion: 1,
					executeFunctions: {},
				} as any, // Fake node object
				`Failed to prepare tool "${tool.name}": Schema conversion error. ${error.message}. Input schema: ${JSON.stringify(tool.inputSchema)}`,
				{ itemIndex: 0 }, // itemIndex might not be relevant here, but the field is often expected
			);
		}
		// If it's not an UnsupportedSchemaError, re-throw the original error
		throw error;
	}

	return new DynamicStructuredTool({
		name: tool.name,
		description: tool.description ?? '',
		schema: zodSchema,
		func: onCallTool,
		metadata: { isFromToolkit: true },
	});
}

export class McpToolkit extends Toolkit {
	constructor(public tools: Array<DynamicStructuredTool<ZodTypeAny>>) {
		super();
	}
}

function safeCreateUrl(url: string, baseUrl?: string | URL): Result<URL, Error> {
	try {
		return createResultOk(new URL(url, baseUrl));
	} catch (error) {
		return createResultError(error);
	}
}

function normalizeAndValidateUrl(input: string): Result<URL, Error> {
	const withProtocol = !/^https?:\/\//i.test(input) ? `https://${input}` : input;
	const parsedUrl = safeCreateUrl(withProtocol);

	if (!parsedUrl.ok) {
		return createResultError(parsedUrl.error);
	}

	return parsedUrl;
}

type ConnectMcpClientError =
	| { type: 'invalid_url'; error: Error }
	| { type: 'connection'; error: Error };

export async function connectMcpClient({
	headers,
	sseEndpoint,
	name,
	version,
}: {
	sseEndpoint: string;
	headers?: Record<string, string>;
	name: string;
	version: number;
}): Promise<Result<Client, ConnectMcpClientError>> {
	try {
		const endpoint = normalizeAndValidateUrl(sseEndpoint);

		if (!endpoint.ok) {
			return createResultError({ type: 'invalid_url', error: endpoint.error });
		}

		const transport = new SSEClientTransport(endpoint.result, {
			eventSourceInit: {
				fetch: async (url, init) =>
					await fetch(url, {
						...init,
						headers: {
							...headers,
							Accept: 'text/event-stream',
						},
					}),
			},
			requestInit: { headers },
		});

		const client = new Client(
			{ name, version: version.toString() },
			{ capabilities: { tools: {} } },
		);

		await client.connect(transport);
		return createResultOk(client);
	} catch (error) {
		return createResultError({ type: 'connection', error });
	}
}

export async function getAuthHeaders(
	ctx: Pick<IExecuteFunctions, 'getCredentials'>,
	authentication: McpAuthenticationOption,
): Promise<{ headers?: Record<string, string> }> {
	switch (authentication) {
		case 'headerAuth': {
			const header = await ctx
				.getCredentials<{ name: string; value: string }>('httpHeaderAuth')
				.catch(() => null);

			if (!header) return {};

			return { headers: { [header.name]: header.value } };
		}
		case 'bearerAuth': {
			const result = await ctx
				.getCredentials<{ token: string }>('httpBearerAuth')
				.catch(() => null);

			if (!result) return {};

			return { headers: { Authorization: `Bearer ${result.token}` } };
		}
		case 'none':
		default: {
			return {};
		}
	}
}
