import { publicMessages } from './content/public';
import { destinationMessages } from './content/destinations';
import { common } from './content/common';
import { guest } from './content/guest';
import { operations } from './content/operations';
import { notices } from './content/notices';
export const catalog = { ...common, ...guest, ...operations, ...notices, ...publicMessages, ...destinationMessages } as const;
export type MessageKey = keyof typeof catalog;
