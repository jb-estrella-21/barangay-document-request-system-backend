export type FieldDefinition = {
  key: string;
  label: string;
  type: 'text' | 'date' | 'select';
  required: boolean;
  options?: string[];
};
