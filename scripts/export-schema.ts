import { writeFile } from 'node:fs/promises';
import { bossJsonSchema, commandJsonSchema } from '../engine/boss-api';
import { gateReportJsonSchema } from '../engine/gate-report';

const target = new URL('../engine/boss.schema.json', import.meta.url);
await writeFile(target, `${JSON.stringify(bossJsonSchema(), null, 2)}\n`);
console.log('Exported engine/boss.schema.json');
await writeFile(new URL('../engine/boss-command.schema.json', import.meta.url), `${JSON.stringify(commandJsonSchema(), null, 2)}\n`);
console.log('Exported engine/boss-command.schema.json');
await writeFile(new URL('../engine/gate-report.schema.json', import.meta.url), `${JSON.stringify(gateReportJsonSchema(), null, 2)}\n`);
console.log('Exported engine/gate-report.schema.json');
