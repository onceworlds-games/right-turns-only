// Bake the CC0 models (Quaternius, see CREDITS.md) into small files for the game: only the animations it plays, welded,
// quantized and meshopt-compressed. Run: npm run bake -- <folder with the downloaded .glb files>
//
// Cars keep their body and wheel nodes (the wheels spin); people and dogs keep their skeleton and a few clips.

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, weld, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = resolve(process.argv[2] || '.');
const out = resolve(new URL('../public/models', import.meta.url).pathname);
mkdirSync(out, { recursive: true });

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const CARS = ['car1', 'car2', 'police', 'suv', 'sports1', 'sports2', 'taxi'];
const PEOPLE = ['man', 'man2', 'man-long', 'man-suit', 'woman', 'woman-casual', 'woman-dress', 'woman-tank'];
const DOGS = ['shiba', 'husky'];
const PEOPLE_CLIPS = /(^|[_|])(Idle|Walk|Run|Clapping|Jump|Sitting)$/;
const DOG_CLIPS = /^(Idle|Walk|Gallop|Attack|Idle_2)$/;

async function bake(name, keep) {
  const doc = await io.read(join(src, `${name}.glb`));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) {
    if (!keep || !keep.test(a.getName())) a.dispose();
  }
  // Rename clips to their short names (Man_Walk → Walk, AnimalArmature|Walk → Walk).
  for (const a of root.listAnimations()) a.setName(a.getName().replace(/^.*[|]/, '').replace(/^(Man|Female)_/, ''));
  await doc.transform(dedup(), prune(), weld(), resample(), quantize({ quantizeNormal: 10, quantizePosition: 14 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const file = join(out, `${name}.glb`);
  await io.write(file, doc);
  console.log(`${name}.glb  ${(statSync(file).size / 1024).toFixed(0)} KB  clips: ${root.listAnimations().map((a) => a.getName()).join(', ') || '-'}`);
}

for (const n of CARS) await bake(n, null);
for (const n of PEOPLE) await bake(n, PEOPLE_CLIPS);
for (const n of DOGS) await bake(n, DOG_CLIPS);
