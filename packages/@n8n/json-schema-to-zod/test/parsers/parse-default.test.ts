import { parseDefault, UnsupportedSchemaError } from '../../src/parsers/parse-default'; // Adjust path based on actual file structure if src is not directly under package root for tests
import type { JsonSchemaObject } from '../../src/types';

describe('parseDefault', () => {
	it('should throw an UnsupportedSchemaError', () => {
		const schema: JsonSchemaObject = { type: 'string', format: 'custom-unsupported-format' };
		expect(() => parseDefault(schema)).toThrow(UnsupportedSchemaError);
	});

	it('should include the schema type or stringified schema in the error message', () => {
		const schemaWithString: JsonSchemaObject = { type: 'custom_type' };
		try {
			parseDefault(schemaWithString);
		} catch (e: any) {
			expect(e).toBeInstanceOf(UnsupportedSchemaError);
			expect(e.message).toContain('custom_type');
		}

		const schemaWithObject: JsonSchemaObject = { format: 'very-specific-format', description: 'A test schema' };
		try {
			parseDefault(schemaWithObject);
		} catch (e: any) {
			expect(e).toBeInstanceOf(UnsupportedSchemaError);
			// Check if part of the stringified schema is in the message
			expect(e.message).toContain('very-specific-format');
		}
	});

	it('should correctly use the name "UnsupportedSchemaError" for the error thrown', () => {
		const schema: JsonSchemaObject = { type: 'string' };
		try {
			parseDefault(schema);
			// Should not reach here
			expect(true).toBe(false);
		} catch (e: any) {
			expect(e.name).toBe('UnsupportedSchemaError');
		}
	});
});
