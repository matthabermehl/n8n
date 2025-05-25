import {
	type ILoadOptionsFunctions,
	type INodePropertyOptions,
	NodeOperationError,
} from 'n8n-workflow';

import type { McpAuthenticationOption } from './types';
import { connectMcpClient, getAllTools, getAuthHeaders } from './utils';

export async function getTools(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const authentication = this.getNodeParameter('authentication') as McpAuthenticationOption;
	const sseEndpoint = this.getNodeParameter('sseEndpoint') as string;
	const node = this.getNode();
	const { headers } = await getAuthHeaders(this, authentication);
	const client = await connectMcpClient({
		sseEndpoint,
		headers,
		name: node.type,
		version: node.typeVersion,
	});

	if (!client.ok) {
		throw new NodeOperationError(this.getNode(), 'Could not connect to your MCP server');
	}

	const toolsArray = await getAllTools(client.result);

	// Defensive check: Ensure toolsArray is an array before calling .map
	if (!Array.isArray(toolsArray)) {
		this.logger.warn(
			`[McpClientTool/loadOptions.ts] getAllTools did not return an array. Received: ${JSON.stringify(toolsArray)}. Returning empty options.`,
		);
		return []; // Return empty options to prevent error
	}

	return toolsArray.map((tool) => ({
		name: tool.name,
		value: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
}
