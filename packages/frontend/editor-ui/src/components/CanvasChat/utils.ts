import { CHAT_TRIGGER_NODE_TYPE, MANUAL_CHAT_TRIGGER_NODE_TYPE } from '@/constants';
import { type IExecutionResponse, type INodeUi, type IWorkflowDb } from '@/Interface';
import { type ChatMessage } from '@n8n/chat/types';
import { get, isEmpty } from 'lodash-es';
import { NodeConnectionTypes, type IDataObject, type IRunExecutionData } from 'n8n-workflow';
import { v4 as uuid } from 'uuid';

export function isChatNode(node: INodeUi) {
	return [CHAT_TRIGGER_NODE_TYPE, MANUAL_CHAT_TRIGGER_NODE_TYPE].includes(node.type);
}

export function getInputKey(node: INodeUi): string {
	if (node.type === MANUAL_CHAT_TRIGGER_NODE_TYPE && node.typeVersion < 1.1) {
		return 'input';
	}
	if (node.type === CHAT_TRIGGER_NODE_TYPE) {
		return 'chatInput';
	}

	return 'chatInput';
}

function extractChatInput(
	workflow: IWorkflowDb,
	resultData: IRunExecutionData['resultData'],
): ChatMessage | undefined {
	const chatTrigger = workflow.nodes.find(isChatNode);

	if (chatTrigger === undefined) {
		return undefined;
	}

	const inputKey = getInputKey(chatTrigger);
	const runData = (resultData.runData[chatTrigger.name] ?? [])[0];
	const message = runData?.data?.[NodeConnectionTypes.Main]?.[0]?.[0]?.json?.[inputKey];

	if (runData === undefined || typeof message !== 'string') {
		return undefined;
	}

	return {
		text: message,
		sender: 'user',
		id: uuid(),
	};
}

export function extractBotResponse(
	resultData: IRunExecutionData['resultData'],
	executionId: string,
	emptyText?: string,
): ChatMessage | undefined {
	const lastNodeExecuted = resultData.lastNodeExecuted;

	if (!lastNodeExecuted) return undefined;

	const nodeResponseDataArray = get(resultData.runData, lastNodeExecuted) ?? [];

	const nodeResponseData = nodeResponseDataArray[nodeResponseDataArray.length - 1];

	let responseMessage: string;

	if (get(nodeResponseData, 'error')) {
		responseMessage = '[ERROR: ' + get(nodeResponseData, 'error.message') + ']';
	} else {
		const responseData = get(nodeResponseData, 'data.main[0][0].json');
		const text = extractResponseText(responseData) ?? emptyText;

		if (!text) {
			return undefined;
		}

		responseMessage = text;
	}

	return {
		text: responseMessage,
		sender: 'bot',
		id: executionId ?? uuid(),
	};
}

/** Extracts response message from workflow output */
function extractResponseText(responseData?: IDataObject): string | undefined {
	if (!responseData || isEmpty(responseData)) {
		return undefined;
	}

	// Paths where the response message might be located
	const paths = ['output', 'text', 'response.text'];
	const matchedPath = paths.find((path) => get(responseData, path));

	if (!matchedPath) {
		// Create a safe copy of responseData for JSON stringification
		// Exclude or fix problematic properties like 'tools' that might not be arrays
		const safeResponseData = { ...responseData };

		// If tools exists and is not an array, either convert it or exclude it
		if ('tools' in safeResponseData) {
			if (Array.isArray(safeResponseData.tools)) {
				// Keep it as is if it's already an array
			} else if (safeResponseData.tools && typeof safeResponseData.tools === 'object') {
				// Convert object to array or exclude it
				delete safeResponseData.tools; // Safer to exclude non-array tools
			} else {
				// For any other type, exclude it
				delete safeResponseData.tools;
			}
		}

		return JSON.stringify(safeResponseData, null, 2);
	}

	const matchedOutput = get(responseData, matchedPath);
	if (typeof matchedOutput === 'object') {
		return '```json\n' + JSON.stringify(matchedOutput, null, 2) + '\n```';
	}

	return matchedOutput?.toString() ?? '';
}

export function restoreChatHistory(
	workflowExecutionData: IExecutionResponse | null,
	emptyText?: string,
): ChatMessage[] {
	if (!workflowExecutionData?.data) {
		return [];
	}

	const userMessage = extractChatInput(
		workflowExecutionData.workflowData,
		workflowExecutionData.data.resultData,
	);
	const botMessage = extractBotResponse(
		workflowExecutionData.data.resultData,
		workflowExecutionData.id,
		emptyText,
	);

	return [...(userMessage ? [userMessage] : []), ...(botMessage ? [botMessage] : [])];
}
