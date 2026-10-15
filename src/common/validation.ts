import { BadRequestException } from '@nestjs/common';
import { FieldDefinition } from './validation.types';

export function validateFieldDefinitions(value: unknown): FieldDefinition[] {
  if (!Array.isArray(value)) throw new BadRequestException('fields must be an array');
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new BadRequestException(`fields[${index}] must be an object`);
    const field = entry as Record<string, unknown>;
    if (typeof field.key !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(field.key)) throw new BadRequestException(`fields[${index}].key is invalid`);
    if (seen.has(field.key)) throw new BadRequestException(`Duplicate field key: ${field.key}`);
    seen.add(field.key);
    if (typeof field.label !== 'string' || field.label.trim().length < 1 || field.label.length > 100) throw new BadRequestException(`fields[${index}].label is invalid`);
    if (!['text', 'date', 'select'].includes(String(field.type))) throw new BadRequestException(`fields[${index}].type must be text, date, or select`);
    if (typeof field.required !== 'boolean') throw new BadRequestException(`fields[${index}].required must be a boolean`);
    if (field.type === 'select') {
      if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 50 || field.options.some((option) => typeof option !== 'string' || option.length > 100)) {
        throw new BadRequestException(`fields[${index}].options must contain 1 to 50 short strings`);
      }
    } else if (field.options !== undefined) {
      throw new BadRequestException(`fields[${index}].options is only allowed for select fields`);
    }
    return {
      key: field.key,
      label: field.label.trim(),
      type: field.type as FieldDefinition['type'],
      required: field.required,
      ...(field.type === 'select' ? { options: field.options as string[] } : {}),
    };
  });
}

export function validateApplicantFields(definitions: FieldDefinition[], submitted: unknown): Record<string, string> {
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) throw new BadRequestException('fields must be an object');
  const values = submitted as Record<string, unknown>;
  const definitionsByKey = new Map(definitions.map((field) => [field.key, field]));
  for (const key of Object.keys(values)) {
    if (!definitionsByKey.has(key)) throw new BadRequestException(`Unexpected applicant field: ${key}`);
  }

  const result: Record<string, string> = {};
  for (const field of definitions) {
    const value = values[field.key];
    if (value === undefined || value === null || value === '' || (field.required && typeof value === 'string' && value.trim() === '')) {
      if (field.required) throw new BadRequestException(`${field.label} is required`);
      continue;
    }
    if (typeof value !== 'string' || value.length > 1000) throw new BadRequestException(`${field.label} must be a string of at most 1000 characters`);
    if (field.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${field.label} must use YYYY-MM-DD`);
      const [year, month, day] = value.split('-').map(Number);
      if (new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== value) throw new BadRequestException(`${field.label} must be a valid date`);
    }
    if (field.type === 'select' && !field.options?.includes(value)) throw new BadRequestException(`${field.label} is not an allowed option`);
    result[field.key] = value;
  }
  return result;
}
