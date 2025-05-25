import type { ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { omit } from 'lodash';
import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { jsonParse, NodeOperationError, sleep } from 'n8n-workflow';

import { getPromptInputByType } from '../../../../../../utils/helpers';
import { getOptionalOutputParser } from '../../../../../../utils/output_parsers/N8nOutputParser';
import {
	fixEmptyContentMessage,
	getAgentStepsParser,
	getChatModel,
	getOptionalMemory,
	getTools,
	prepareMessages,
	preparePrompt,
} from '../common';
import { SYSTEM_MESSAGE } from '../prompt';

/* -----------------------------------------------------------
   Main Executor Function
----------------------------------------------------------- */
/**
 * The main executor method for the Tools Agent.
 *
 * This function retrieves necessary components (model, memory, tools), prepares the prompt,
 * creates the agent, and processes each input item. The error handling for each item is also
 * managed here based on the node's continueOnFail setting.
 *
 * @returns The array of execution data for all processed items
 */
export async function toolsAgentExecute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	this.logger.debug('Executing Tools Agent V2');

	const returnData: INodeExecutionData[] = [];
	const items = this.getInputData();
	const outputParser = await getOptionalOutputParser(this);

	// Destructure tools and closeFunctions from the result of getTools
	const toolsResult = await getTools(this, outputParser);

	// --- BEGIN ENHANCED DIAGNOSTIC LOGGING ---
	this.logger.debug('[ToolsAgent/V2/execute.ts] getTools returned:', {
		type: typeof toolsResult,
		isObject: typeof toolsResult === 'object' && toolsResult !== null,
		hasToolsProperty: toolsResult && 'tools' in toolsResult,
		hasCloseFunctionsProperty: toolsResult && 'closeFunctions' in toolsResult,
		toolsType: toolsResult?.tools ? typeof toolsResult.tools : 'undefined',
		toolsIsArray: Array.isArray(toolsResult?.tools),
		toolsLength: Array.isArray(toolsResult?.tools) ? toolsResult.tools.length : 'N/A',
		closeFunctionsType: toolsResult?.closeFunctions
			? typeof toolsResult.closeFunctions
			: 'undefined',
		closeFunctionsIsArray: Array.isArray(toolsResult?.closeFunctions),
		closeFunctionsLength: Array.isArray(toolsResult?.closeFunctions)
			? toolsResult.closeFunctions.length
			: 'N/A',
	});
	// --- END ENHANCED DIAGNOSTIC LOGGING ---

	const { tools, closeFunctions } = toolsResult;

	// --- BEGIN DEFENSIVE PROGRAMMING ---
	if (!Array.isArray(tools)) {
		this.logger.error('[ToolsAgent/V2/execute.ts] tools is not an array!', {
			toolsType: typeof tools,
			toolsValue: tools,
			toolsResultType: typeof toolsResult,
			toolsResultValue: toolsResult,
		});
		throw new NodeOperationError(
			this.getNode(),
			`Expected tools to be an array, but got ${typeof tools}. Tools value: ${JSON.stringify(tools)}`,
		);
	}

	if (!Array.isArray(closeFunctions)) {
		this.logger.error('[ToolsAgent/V2/execute.ts] closeFunctions is not an array!', {
			closeFunctionsType: typeof closeFunctions,
			closeFunctionsValue: closeFunctions,
		});
		throw new NodeOperationError(
			this.getNode(),
			`Expected closeFunctions to be an array, but got ${typeof closeFunctions}. Value: ${JSON.stringify(closeFunctions)}`,
		);
	}
	// --- END DEFENSIVE PROGRAMMING ---

	// --- BEGIN DIAGNOSTIC LOGGING ---
	this.logger.debug(
		`[ToolsAgent/V2/execute.ts] About to use tools. Array.isArray(tools): ${Array.isArray(tools)}`,
	);
	if (Array.isArray(tools)) {
		this.logger.debug(
			`[ToolsAgent/V2/execute.ts] Tools being passed to LangChain: ${JSON.stringify(
				tools.map((t) => ({
					name: t.name,
					description: t.description,
					// schema: JSON.stringify(t.schema), // Schema can be verbose
					constructorName: t.constructor?.name,
				})),
			)}`,
		);
	}
	// --- END DIAGNOSTIC LOGGING ---

	const batchSize = this.getNodeParameter('options.batching.batchSize', 0, 1) as number;
	const delayBetweenBatches = this.getNodeParameter(
		'options.batching.delayBetweenBatches',
		0,
		0,
	) as number;
	const memory = await getOptionalMemory(this);
	const model = await getChatModel(this);

	try {
		for (let i = 0; i < items.length; i += batchSize) {
			const batch = items.slice(i, i + batchSize);
			const batchPromises = batch.map(async (_item, batchItemIndex) => {
				const itemIndex = i + batchItemIndex;

				const input = getPromptInputByType({
					ctx: this,
					i: itemIndex,
					inputKey: 'text',
					promptTypeKey: 'promptType',
				});
				if (input === undefined) {
					throw new NodeOperationError(this.getNode(), 'The "text" parameter is empty.');
				}

				const options = this.getNodeParameter('options', itemIndex, {}) as {
					systemMessage?: string;
					maxIterations?: number;
					returnIntermediateSteps?: boolean;
					passthroughBinaryImages?: boolean;
				};

				// Prepare the prompt messages and prompt template.
				const messages = await prepareMessages(this, itemIndex, {
					systemMessage: options.systemMessage,
					passthroughBinaryImages: options.passthroughBinaryImages ?? true,
					outputParser,
				});
				const prompt: ChatPromptTemplate = preparePrompt(messages);

				// Create the base agent that calls tools.
				this.logger.debug('[ToolsAgent/V2/execute.ts] About to create agent with tools', {
					toolsLength: tools.length,
					toolsIsArray: Array.isArray(tools),
				});
				const agent = createToolCallingAgent({
					llm: model,
					tools,
					prompt,
					streamRunnable: false,
				});
				agent.streamRunnable = false;
				// Wrap the agent with parsers and fixes.
				const runnableAgent = RunnableSequence.from([
					agent,
					getAgentStepsParser(outputParser, memory),
					fixEmptyContentMessage,
				]);
				this.logger.debug('[ToolsAgent/V2/execute.ts] About to create AgentExecutor with tools', {
					toolsLength: tools.length,
					toolsIsArray: Array.isArray(tools),
				});
				const executor = AgentExecutor.fromAgentAndTools({
					agent: runnableAgent,
					memory,
					tools,
					returnIntermediateSteps: options.returnIntermediateSteps === true,
					maxIterations: options.maxIterations ?? 10,
				});

				// Invoke the executor with the given input and system message.
				return await executor.invoke(
					{
						input,
						system_message: options.systemMessage ?? SYSTEM_MESSAGE,
						formatting_instructions:
							'IMPORTANT: For your response to user, you MUST use the `format_final_json_response` tool with your complete answer formatted according to the required schema. Do not attempt to format the JSON manually - always use this tool. Your response will be rejected if it is not properly formatted through this tool. Only use this tool once you are ready to provide your final answer.',
					},
					{ signal: this.getExecutionCancelSignal() },
				);
			});

			const batchResults = await Promise.allSettled(batchPromises);

			batchResults.forEach((result, index) => {
				const itemIndex = i + index;
				if (result.status === 'rejected') {
					const error = result.reason as Error;
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: error.message },
							pairedItem: { item: itemIndex },
						});
						return;
					} else {
						throw new NodeOperationError(this.getNode(), error);
					}
				}
				const response = result.value;
				// If memory and outputParser are connected, parse the output.
				if (memory && outputParser) {
					const parsedOutput = jsonParse<{ output: Record<string, unknown> }>(
						response.output as string,
					);
					response.output = parsedOutput?.output ?? parsedOutput;
				}

				// Omit internal keys before returning the result.
				const itemResult = {
					json: omit(
						response,
						'system_message',
						'formatting_instructions',
						'input',
						'chat_history',
						'agent_scratchpad',
					),
					pairedItem: { item: itemIndex },
				};

				returnData.push(itemResult);
			});

			if (i + batchSize < items.length && delayBetweenBatches > 0) {
				await sleep(delayBetweenBatches);
			}
		}
	} finally {
		this.logger.info(
			`ToolsAgent V2 execution finished. Closing ${closeFunctions.length} toolkit connections.`,
		);
		for (const close of closeFunctions) {
			try {
				await close();
				this.logger.debug('Successfully closed toolkit connection.');
			} catch (e: any) {
				this.logger.error(`Error closing toolkit connection: ${e.message}`, { error: e });
			}
		}
	}

	return [returnData];
}
