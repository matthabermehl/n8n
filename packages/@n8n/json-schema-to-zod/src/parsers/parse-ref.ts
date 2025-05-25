import * as z from 'zod';

import type { JsonSchemaObject, Refs } from '../types';

export const parseRef = (
	jsonSchema: JsonSchemaObject & { $ref: string },
	refs: Refs,
): z.ZodTypeAny => {
	// Handle self-reference ($ref: "#")
	if (jsonSchema.$ref === '#') {
		// For self-references, we need to create a lazy schema that refers to the root
		// This is a basic implementation for recursive structures
		return z.lazy(() => {
			// Get the root schema from the refs path
			const rootSchema = refs.path[0] || jsonSchema;
			// Parse the root schema without the $ref to avoid infinite recursion
			const { $ref, ...schemaWithoutRef } = rootSchema as JsonSchemaObject & { $ref?: string };
			return z.any(); // For now, return z.any() to avoid infinite recursion
		});
	}

	// For other $ref types, we don't support them yet
	throw new Error(
		`Unsupported $ref: ${jsonSchema.$ref}. Only self-references ($ref: "#") are currently supported.`,
	);
};
