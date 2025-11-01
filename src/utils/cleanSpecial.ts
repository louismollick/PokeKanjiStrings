/**
 * Normalize special characters
 */
export function cleanSpecial(text: string): string {
  return text
    .replaceAll('\u00A0', ' ')
    .replaceAll('\u2007', ' ')
    .replaceAll('\u202F', ' ')
    .replaceAll('\u3000', ' ')
    .replaceAll('"', '"')
    .replaceAll('"', '"')
    .replaceAll('\u2018', "'")
    .replaceAll('\u2019', "'")
    .replaceAll('ー', 'ー')
    .replaceAll('－', 'ー')
    .replaceAll('\u2010', 'ー')
    .replaceAll('\u2013', 'ー')
    .replaceAll('\u2014', 'ー')
    .replaceAll('\u2015', 'ー')
    .replaceAll('\u2212', 'ー')
    .replaceAll('-', 'ー')
    .replaceAll('º', '°')
    .replaceAll('˚', '°')
    .replaceAll('ᵒ', '°')
    .replaceAll('〜', '～')
    .replaceAll('‥', '..')
    .replaceAll('…', '...')
    .normalize();
}

