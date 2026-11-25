import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const file = new URL("../data/questions.json", import.meta.url);
const { title, publisher, sources, questions } = JSON.parse(await readFile(file, "utf8"));
const hasText = value => typeof value === "string" && value.trim().length > 0;
const isHttps = value => typeof value === "string" && URL.canParse(value)
  && new URL(value).protocol === "https:";
const validTypes = new Set(["single", "multiple", "boolean", "fill"]);
assert.ok(hasText(title) && hasText(publisher), "题库须有标题和发布来源");
assert.ok(Array.isArray(sources) && sources.length, "至少需要一个题目来源");
assert.ok(Array.isArray(questions) && questions.length, "至少需要一道题");
const counts = new Map();
for (const source of sources) {
  assert.match(source.id, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!counts.has(source.id), "重复的来源 ID " + source.id);
  const hasSource = source.url === undefined ? hasText(source.document) : isHttps(source.url);
  assert.ok(hasText(source.title) && hasText(source.topic) && hasSource, "来源信息不全 " + source.id);
  counts.set(source.id, new Set());
}

const ids = new Set();
for (const question of questions) {
  const { id, source, number, type, prompt, analysis, options, answer, fields } = question;
  assert.ok(hasText(id) && !ids.has(id), "题目 ID 缺失或重复 " + id);
  ids.add(id);
  assert.ok(validTypes.has(type) && hasText(prompt) && hasText(analysis), "题型、题干或解析有误 " + id);
  const numbers = counts.get(source);
  assert.ok(numbers && Number.isInteger(number) && number > 0 && !numbers.has(number), "来源或原题号有误 " + id);
  numbers.add(number);

  if (type === "fill") {
    assert.ok(Array.isArray(fields) && fields.length && fields.every(field =>
      hasText(field.label) && Array.isArray(field.accepted) && field.accepted.length
      && field.accepted.every(hasText)), "填空答案缺失 " + id);
  } else {
    assert.ok(Array.isArray(options) && options.length === (type === "boolean" ? 2 : 4)
      && new Set(options).size === options.length && options.every(hasText), "选项有误 " + id);
    assert.ok(Array.isArray(answer) && answer.length > 0 && (type === "multiple" || answer.length === 1)
      && new Set(answer).size === answer.length
      && answer.every(index => Number.isInteger(index) && index >= 0 && index < options.length),
    "答案有误 " + id);
  }
  assert.ok((question.references ?? []).every(reference =>
    hasText(reference.title) && isHttps(reference.url)), "参考来源有误 " + id);
}

for (const { id, count } of sources) {
  assert.equal(counts.get(id).size, count, "来源题数不一致 " + id);
}
console.log(`已检查 ${sources.length} 个来源及 ${questions.length} 道题。`);
