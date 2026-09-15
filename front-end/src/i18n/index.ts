import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';
import type { InterfaceLanguage } from '../contexts/InterfaceLanguageContext';

export const messages = {
  zh: zhCN,
  en: enUS,
} as const;

type MessageTree = typeof zhCN | typeof enUS;
type LeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : LeafPaths<T[K], `${Prefix}${K}.`>
}[keyof T & string];

export type TranslationKey = LeafPaths<MessageTree>;

const readPath = (source: MessageTree, key: TranslationKey): string => {
  const value = key.split('.').reduce<unknown>((current, part) => (
    current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined
  ), source);
  return typeof value === 'string' ? value : key;
};

export function translate(language: InterfaceLanguage, key: TranslationKey, values?: Record<string, string | number>): string {
  const template = readPath(messages[language], key);
  return values
    ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`))
    : template;
}
