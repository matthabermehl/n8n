import { mcpToolToDynamicTool } from './utils'; // Assuming this is the correct path to the function
import { UnsupportedSchemaError, convertJsonSchemaToZod } from '../../../utils/schemaParsing'; // Corrected path
import { NodeOperationError } from 'n8n-workflow';
import type { McpTool } from './types'; // Assuming types are here
import { DynamicStructuredTool } from 'langchain/tools';

// Mock the ../../../utils/schemaParsing module
jest.mock('../../../utils/schemaParsing', () => ({ // Corrected path
	...jest.requireActual('../../../utils/schemaParsing'), // Import and retain default behavior
	convertJsonSchemaToZod: jest.fn(), // Mock specific function
	UnsupportedSchemaError: jest.requireActual('../../../utils/schemaParsing').UnsupportedSchemaError, // Use actual error class
}));

describe('mcpToolToDynamicTool', () => {
	const mockOnCallTool = jest.fn();
	const basicMcpTool: McpTool = {
		name: 'testTool',
		description: 'A test tool',
		inputSchema: { type: 'object', properties: { param: { type: 'string' } } },
		// Add any other required fields for McpTool if necessary
		// For the purpose of these tests, we'll assume the minimum fields are covered.
		// If the McpTool type requires more, they might need to be added.
		// Based on McpClientTool.node.ts, McpTool can also have `id`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`.
		// However, mcpToolToDynamicTool only uses `name`, `description`, and `inputSchema`.
		id: 'test-id',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		createdBy: 'test-user',
		updatedBy: 'test-user',

	};

	beforeEach(() => {
		// Clear mock history before each test
		mockOnCallTool.mockClear();
		(convertJsonSchemaToZod as jest.Mock).mockClear();
	});

	it('should correctly convert a valid schema', () => {
		const mockZodSchema = { parse: jest.fn() } as any; // A mock Zod schema
		(convertJsonSchemaToZod as jest.Mock).mockReturnValue(mockZodSchema);

		const dynamicTool = mcpToolToDynamicTool(basicMcpTool, mockOnCallTool);

		expect(dynamicTool).toBeInstanceOf(DynamicStructuredTool);
		expect(dynamicTool.name).toBe(basicMcpTool.name);
		expect(dynamicTool.description).toBe(basicMcpTool.description);
		expect(dynamicTool.schema).toBe(mockZodSchema);
		expect(convertJsonSchemaToZod).toHaveBeenCalledWith(basicMcpTool.inputSchema);
	});

	it('should throw NodeOperationError if schema conversion fails with UnsupportedSchemaError', () => {
		const errorMessage = 'Unsupported schema type foobar';
		(convertJsonSchemaToZod as jest.Mock).mockImplementation(() => {
			throw new UnsupportedSchemaError(errorMessage);
		});

		expect(() => mcpToolToDynamicTool(basicMcpTool, mockOnCallTool)).toThrow(NodeOperationError);
		try {
			mcpToolToDynamicTool(basicMcpTool, mockOnCallTool);
		} catch (e: any) {
			expect(e).toBeInstanceOf(NodeOperationError);
			expect(e.message).toContain(`Failed to prepare tool "${basicMcpTool.name}"`);
			expect(e.message).toContain('Schema conversion error');
			expect(e.message).toContain(errorMessage);
			expect(e.message).toContain(JSON.stringify(basicMcpTool.inputSchema));
		}
	});

	it('should re-throw other errors if schema conversion fails with a different error', () => {
		const otherErrorMessage = 'Some other generic error';
		(convertJsonSchemaToZod as jest.Mock).mockImplementation(() => {
			throw new Error(otherErrorMessage);
		});

		expect(() => mcpToolToDynamicTool(basicMcpTool, mockOnCallTool)).toThrow(Error);
		expect(() => mcpToolToDynamicTool(basicMcpTool, mockOnCallTool)).not.toThrow(NodeOperationError); // Ensure it's not wrapped
		try {
			mcpToolToDynamicTool(basicMcpTool, mockOnCallTool);
		} catch (e: any) {
			expect(e.message).toBe(otherErrorMessage);
		}
	});
});
