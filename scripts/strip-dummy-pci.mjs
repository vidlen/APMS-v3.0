import { readFileSync, writeFileSync } from 'node:fs';

const FILES = ['public/data/pavement-data.json', 'public/data/pavement-data-2024.json'];

for (const path of FILES) {
  const fc = JSON.parse(readFileSync(path, 'utf8'));
  let stripped = 0;
  for (const f of fc.features) {
    if ('PCI Rating' in f.properties) {
      delete f.properties['PCI Rating'];
      stripped += 1;
    }
  }
  writeFileSync(path, JSON.stringify(fc, null, 0));
  console.log(`${path}: ${stripped} PCI Rating properties removed`);
}
