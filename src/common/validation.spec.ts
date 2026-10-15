import { BadRequestException } from '@nestjs/common';
import { validateApplicantFields, validateFieldDefinitions } from './validation';

describe('catalog field validation', () => {
  const definitions = validateFieldDefinitions([
    { key: 'purpose', label: 'Purpose', type: 'text', required: true },
    { key: 'visit_date', label: 'Visit date', type: 'date', required: false },
    { key: 'category', label: 'Category', type: 'select', required: true, options: ['A', 'B'] },
  ]);

  it('accepts values matching the immutable catalog field definitions', () => {
    expect(validateApplicantFields(definitions, { purpose: 'Employment', category: 'A', visit_date: '2026-10-20' })).toEqual({
      purpose: 'Employment', category: 'A', visit_date: '2026-10-20',
    });
  });

  it('rejects missing required values, unknown keys, and unsupported select values', () => {
    expect(() => validateApplicantFields(definitions, { category: 'A' })).toThrow(BadRequestException);
    expect(() => validateApplicantFields(definitions, { purpose: 'Work', category: 'A', private: 'unexpected' })).toThrow(BadRequestException);
    expect(() => validateApplicantFields(definitions, { purpose: 'Work', category: 'C' })).toThrow(BadRequestException);
    expect(() => validateApplicantFields(definitions, { purpose: '   ', category: 'A' })).toThrow(BadRequestException);
  });

  it('accepts exact field value length and valid date boundaries while rejecting overflow', () => {
    expect(validateApplicantFields(definitions, { purpose: 'x'.repeat(1000), category: 'B', visit_date: '2024-02-29' }).purpose).toHaveLength(1000);
    expect(() => validateApplicantFields(definitions, { purpose: 'x'.repeat(1001), category: 'A' })).toThrow(BadRequestException);
    expect(() => validateApplicantFields(definitions, { purpose: 'Work', category: 'A', visit_date: '2023-02-29' })).toThrow(BadRequestException);
  });

  it('rejects duplicate keys and unsupported field types in catalog definitions', () => {
    expect(() => validateFieldDefinitions([
      { key: 'same', label: 'First', type: 'text', required: true },
      { key: 'same', label: 'Second', type: 'text', required: false },
    ])).toThrow(BadRequestException);
    expect(() => validateFieldDefinitions([{ key: 'file', label: 'File', type: 'file', required: false }])).toThrow(BadRequestException);
  });
});
