import { describe, expect, it } from 'vitest';
import { prepareExternalUrl } from './links';

describe('prepareExternalUrl', () => {
  it('strips attach/attachment/bcc from mailto links', () => {
    expect(prepareExternalUrl('mailto:a@b.test?attach=/etc/passwd&subject=Hi')).toBe(
      'mailto:a@b.test?subject=Hi',
    );
    expect(prepareExternalUrl('mailto:a@b.test?Attachment=/x&BCC=c@d.test')).toBe(
      'mailto:a@b.test',
    );
    expect(prepareExternalUrl('mailto:a@b.test?%61ttach=/x&body=ok')).toBe(
      'mailto:a@b.test?body=ok',
    );
  });
  it('leaves other links alone', () => {
    expect(prepareExternalUrl('mailto:a@b.test?subject=Hi')).toBe('mailto:a@b.test?subject=Hi');
    expect(prepareExternalUrl('https://x.test/?attach=1')).toBe('https://x.test/?attach=1');
  });
});
