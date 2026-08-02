import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const publicDir = path.resolve(here, '..', 'public');

export const readPage = (name) => fs.readFileSync(path.join(publicDir, name), 'utf8');

export const getIds = (html) => new Set(
  [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]),
);

export const getLinks = (html) => [
  ...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g),
].map((match) => ({
  href: match[1].match(/\bhref="([^"]+)"/)?.[1] || '',
  text: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  attrs: match[1],
}));

export const hasInlineTailwindConfig = (html) => (
  /<script\s+id="tailwind-config"/.test(html)
);
