// 业务操作：页面只调这里，不直接碰 IndexedDB
import * as db from './db.js';
import { applyAction, insertIndex, planQueue, DISCARDED, MASTERED } from './rules.js';

export const OWNERS = [
  { id: 'tina', name: 'Tina' },
  { id: 'kaka', name: '卡卡' },
];

export const TYPES = [
  { id: 'word', name: '英语单词' },
  { id: 'math', name: '数学知识' },
  { id: 'scene', name: '场景话题' },
];

export const ownerName = id => (OWNERS.find(o => o.id === id) || { name: id }).name;
export const typeName = id => (TYPES.find(t => t.id === id) || { name: id }).name;

const emptyPlan = owner => ({ owner, queue: [], progress: 0, createdAt: 0, updatedAt: 0 });

export async function listKnowledge() {
  const list = await db.getAll('knowledge');
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getKnowledge(id) {
  return db.get('knowledge', id);
}

export async function getPlan(owner) {
  return (await db.get('plans', owner)) || emptyPlan(owner);
}

export async function countRanges(owner) {
  const list = (await db.getAll('knowledge')).filter(k => k.owner === owner);
  const counts = { discarded: 0, due: 0, mastered: 0 };
  for (const k of list) {
    if (k.mastery === DISCARDED) counts.discarded++;
    else if (k.mastery === MASTERED) counts.mastered++;
    else counts.due++;
  }
  return counts;
}

export async function addKnowledge({ owner, type, name, text, imageIds }) {
  const now = Date.now();
  const knowledge = {
    id: crypto.randomUUID(),
    owner,
    type,
    name: name.trim(),
    text: text.trim(),
    imageIds: imageIds.slice(),
    mastery: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('knowledge', knowledge);

  const plan = await getPlan(owner);
  plan.queue.splice(insertIndex(plan.progress, plan.queue.length), 0, knowledge.id);
  plan.updatedAt = now;
  await db.put('plans', plan);
  return knowledge;
}

export async function updateKnowledge(id, { type, name, text, imageIds }) {
  const knowledge = await db.get('knowledge', id);
  if (!knowledge) throw new Error('知识不存在');
  Object.assign(knowledge, { type, name: name.trim(), text: text.trim(), imageIds: imageIds.slice(), updatedAt: Date.now() });
  await db.put('knowledge', knowledge);
  return knowledge;
}

export async function removeKnowledge(id) {
  const knowledge = await db.get('knowledge', id);
  await db.del('knowledge', id);
  if (knowledge) await deleteImages(knowledge.imageIds);

  for (const owner of OWNERS) {
    const plan = await db.get('plans', owner.id);
    if (!plan) continue;
    const index = plan.queue.indexOf(id);
    if (index === -1) continue;
    plan.queue.splice(index, 1);
    if (index < plan.progress) plan.progress -= 1;
    plan.progress = Math.max(0, Math.min(plan.progress, plan.queue.length));
    plan.updatedAt = Date.now();
    await db.put('plans', plan);
  }
}

export async function rate(knowledge, action) {
  const now = Date.now();
  knowledge.mastery = applyAction(knowledge.mastery, action, knowledge.createdAt, now);
  knowledge.updatedAt = now;
  await db.put('knowledge', knowledge);
  return knowledge;
}

export async function advance(owner) {
  const plan = await getPlan(owner);
  plan.progress = Math.min(plan.progress + 1, plan.queue.length);
  plan.updatedAt = Date.now();
  await db.put('plans', plan);
  return plan;
}

export async function rebuildPlan(owner, ranges) {
  const list = (await db.getAll('knowledge')).filter(k => k.owner === owner);
  const queue = planQueue(list, ranges);
  if (!queue.length) return { plan: null, count: 0 };
  const now = Date.now();
  const plan = { owner, queue, progress: 0, createdAt: now, updatedAt: now };
  await db.put('plans', plan);
  return { plan, count: queue.length };
}

// 修复被删知识在队列里留下的空洞
export async function cleanPlan(owner) {
  const plan = await getPlan(owner);
  if (!plan.queue.length) return plan;
  const ids = new Set((await db.getAll('knowledge')).map(k => k.id));
  const queue = [];
  let progress = 0;
  plan.queue.forEach((id, index) => {
    if (!ids.has(id)) return;
    queue.push(id);
    if (index < plan.progress) progress += 1;
  });
  if (queue.length === plan.queue.length && progress === plan.progress) return plan;
  plan.queue = queue;
  plan.progress = Math.min(progress, queue.length);
  plan.updatedAt = Date.now();
  await db.put('plans', plan);
  return plan;
}

export async function saveImage(blob) {
  const id = crypto.randomUUID();
  await db.put('images', { id, blob });
  return id;
}

export async function getImage(id) {
  return db.get('images', id);
}

export async function deleteImages(ids) {
  for (const id of ids) await db.del('images', id);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function exportData() {
  const [knowledge, plans, images] = await Promise.all([
    db.getAll('knowledge'),
    db.getAll('plans'),
    db.getAll('images'),
  ]);
  const imageMap = {};
  for (const image of images) imageMap[image.id] = await blobToDataUrl(image.blob);
  const data = { schemaVersion: 1, exportedAt: Date.now(), knowledge, plans, images: imageMap };
  await db.metaSet('lastExportAt', data.exportedAt);
  return data;
}

async function imageEntryToRecord(id, dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return { id, blob };
}

export async function importData(data, mode) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.knowledge) || !Array.isArray(data.plans)) {
    throw new Error('不是有效的备份文件');
  }
  const images = Object.entries(data.images || {});

  if (mode === 'replace') {
    await db.clear('knowledge');
    await db.clear('plans');
    await db.clear('images');
    await db.putMany('knowledge', data.knowledge);
    await db.putMany('plans', data.plans);
    await db.putMany('images', await Promise.all(images.map(([id, url]) => imageEntryToRecord(id, url))));
    return { knowledge: data.knowledge.length, plans: data.plans.length, images: images.length };
  }

  const [localKnowledge, localPlans, localImages] = await Promise.all([
    db.getAll('knowledge'),
    db.getAll('plans'),
    db.getAll('images'),
  ]);
  const knowledgeMap = new Map(localKnowledge.map(k => [k.id, k]));
  const incomingKnowledge = data.knowledge.filter(k => {
    const existing = knowledgeMap.get(k.id);
    return !existing || (k.updatedAt || 0) > (existing.updatedAt || 0);
  });
  const planMap = new Map(localPlans.map(p => [p.owner, p]));
  const incomingPlans = data.plans.filter(p => {
    const existing = planMap.get(p.owner);
    return !existing || (p.updatedAt || 0) > (existing.updatedAt || 0);
  });
  const localImageIds = new Set(localImages.map(i => i.id));
  const incomingImages = await Promise.all(
    images.filter(([id]) => !localImageIds.has(id)).map(([id, url]) => imageEntryToRecord(id, url))
  );

  await db.putMany('knowledge', incomingKnowledge);
  await db.putMany('plans', incomingPlans);
  await db.putMany('images', incomingImages);
  return { knowledge: incomingKnowledge.length, plans: incomingPlans.length, images: incomingImages.length };
}

export async function lastExportAt() {
  return db.metaGet('lastExportAt', 0);
}
