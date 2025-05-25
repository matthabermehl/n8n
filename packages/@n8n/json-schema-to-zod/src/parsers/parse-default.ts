import { z } from 'zod';
import type { JsonSchemaObject } from '../types';

export class UnsupportedSchemaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UnsupportedSchemaError';
	}
}

export const parseDefault = (jsonSchema: JsonSchemaObject) => {
	// Optionally, you could try to include part of the schema in the message,
	// but be careful about PII or overly large schemas.
	// For now, a generic message is safer.
	const schemaType = jsonSchema.type || JSON.stringify(jsonSchema).substring(0, 100);
	throw new UnsupportedSchemaError(
		`Unsupported JSON schema type or structure encountered: ${schemaType}. No specific parser available.`,
	);
};
