import { isConfiguredOrigin } from './origin-policy';

describe('isConfiguredOrigin', () => {
  const allowed = ['https://resident.example', 'https://staff.example'];

  it('allows only exact configured origins', () => {
    expect(isConfiguredOrigin('https://staff.example', allowed)).toBe(true);
    expect(isConfiguredOrigin('https://staff.example.evil.test', allowed)).toBe(false);
    expect(isConfiguredOrigin('https://staff.example/', allowed)).toBe(false);
    expect(isConfiguredOrigin('null', allowed)).toBe(false);
  });
});
