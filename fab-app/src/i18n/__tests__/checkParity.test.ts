// #217 acceptance criterion 3 ("pt-BR has a translation for every en key,
// parity machine-checked") and criterion 5(b) (gate fails on a parity
// mismatch). checkKeyParity is the pure comparison the gate runs; it's
// exercised here against small fixtures (including a deliberately broken
// one simulating an incomplete pt-BR bundle) AND against the real shipped
// bundles, so a future PR that adds an en key without its pt-BR
// translation fails this suite — which `npm run test:run` runs as part of
// `npm run gate`.

import { checkKeyParity } from '../checkParity';
import en from '../locales/en.json';
import ptBR from '../locales/pt-BR.json';

describe('checkKeyParity', () => {
  it('reports no missing keys when both bundles have full parity', () => {
    const result = checkKeyParity({ a: { b: 'x' }, c: 'y' }, { a: { b: 'z' }, c: 'w' });
    expect(result).toEqual({ missingInOther: [], missingInBase: [] });
  });

  it('reports dot-path keys missing from the other bundle (broken-pt-BR fixture)', () => {
    const result = checkKeyParity({ a: { b: 'x' }, c: 'y' }, { a: { b: 'z' } });
    expect(result.missingInOther).toEqual(['c']);
    expect(result.missingInBase).toEqual([]);
  });

  it('reports keys present only in the other bundle', () => {
    const result = checkKeyParity({ a: 'x' }, { a: 'y', b: 'z' });
    expect(result.missingInBase).toEqual(['b']);
  });

  it('flags a nested key missing several levels deep', () => {
    const result = checkKeyParity(
      { onboarding: { consent: { title: 'x', download: 'y' } } },
      { onboarding: { consent: { title: 'x' } } },
    );
    expect(result.missingInOther).toEqual(['onboarding.consent.download']);
  });

  it('has full en/pt-BR key parity in the real shipped bundles', () => {
    const result = checkKeyParity(en, ptBR);
    expect(result.missingInOther).toEqual([]);
    expect(result.missingInBase).toEqual([]);
  });
});
