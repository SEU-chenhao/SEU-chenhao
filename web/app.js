const $ = id => document.getElementById(id);

async function loadBank() {
  const embedded = $("bank");
  if (embedded) return JSON.parse(embedded.textContent);

  const response = await fetch(new URL("./data/questions.json", document.baseURI), { cache: "no-cache" });
  if (!response.ok) throw new Error("Question bank HTTP " + response.status);
  return response.json();
}

const bank = await loadBank().catch(error => {
  $("loading").textContent = location.protocol === "file:"
    ? "本地练习请打开构建后的 dist/index.html。"
    : "题库暂时无法读取，请稍后刷新页面。";
  throw error;
});

const questions = new Map(bank.questions.map(question => [question.id, question]));
const sources = new Map(bank.sources.map(source => [source.id, source]));
const types = { single: "单选题", multiple: "多选题", boolean: "判断题", fill: "填空题" };
const modeNames = { all: "全部题目", wrong: "错题本", saved: "收藏" };
const storageKey = "seu-history-review-2025-v1";
const pageSize = 18;
const letters = "ABCD";

function make(tag, className = "", content = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
}

function button(label, className, action) {
  const node = make("button", className, label);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

function link(title, url) {
  const node = make("a", "", title);
  node.href = url;
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
}

let writable = true;
function read() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || {};
  } catch (error) {
    writable = error instanceof SyntaxError;
    return {};
  }
}

const stored = read();
const results = new Map();
for (const [id, result] of Object.entries(stored.results || {})) {
  if (questions.has(id) && Array.isArray(result?.response) && typeof result.correct === "boolean") {
    results.set(id, { response: result.response, correct: grade(questions.get(id), result.response) });
  }
}
const favorites = new Set((Array.isArray(stored.favorites) ? stored.favorites : []).filter(id => questions.has(id)));
const topics = [...new Set(bank.sources.map(source => source.topic))];
const years = [...new Set(bank.sources.map(source => source.id.slice(0, 4)))].sort().reverse();
const filters = {
  year: years.includes(stored.year) ? stored.year : "",
  topic: topics.includes(stored.topic) ? stored.topic : "",
  source: sources.has(stored.source) ? stored.source : "",
  kind: Object.hasOwn(types, stored.kind) ? stored.kind : "",
};
let mode = Object.hasOwn(modeNames, stored.mode) ? stored.mode : "all";
let order = Array.isArray(stored.order) && new Set(stored.order).size === questions.size
  && stored.order.length === questions.size && stored.order.every(id => questions.has(id)) ? stored.order : null;
let cursor = 0;
let gridPage = 0;
let deck = [];
let roundResults = new Map();
let retryId = null;

function persist() {
  if (!writable) {
    $("storage-note").textContent = "浏览器存储不可用，刷新将清除本次复习记录。";
    return;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      results: Object.fromEntries(results), favorites: [...favorites],
      ...filters, mode, order, current: deck[cursor],
    }));
  } catch {
    writable = false;
    $("storage-note").textContent = "浏览器存储不可用，刷新将清除本次复习记录。";
  }
}

function normalize(text) {
  return String(text).normalize("NFKC").toLocaleLowerCase("zh-CN")
    .replace(/[\p{White_Space}\p{Punctuation}]/gu, "");
}

function grade(question, response) {
  if (question.type === "fill") {
    return question.fields.length === response.length && question.fields.every((field, index) =>
      field.accepted.some(answer => normalize(answer) === normalize(response[index])));
  }
  return question.answer.length === response.length &&
    question.answer.every(index => response.includes(index));
}

function answerText(question) {
  if (question.type === "fill") return question.fields.map(field => field.accepted[0]).join("；");
  if (question.type === "boolean") return question.options[question.answer[0]];
  return question.answer.map(index => letters[index] + " " + question.options[index]).join("；");
}

function setSelect(id, label, options, selected) {
  $(id).replaceChildren(new Option(label, ""), ...options.map(([value, name]) => new Option(name, value)));
  $(id).value = selected;
}

function resetFilters() {
  Object.assign(filters, { year: "", topic: "", source: "", kind: "" });
}

function refreshDeck(preferredId) {
  const yearSources = bank.sources.filter(source => !filters.year || source.id.startsWith(filters.year + "-"));
  const yearTopics = [...new Set(yearSources.map(source => source.topic))];
  if (!yearTopics.includes(filters.topic)) filters.topic = "";
  const sourceOptions = yearSources.filter(source => !filters.topic || source.topic === filters.topic);
  if (!sourceOptions.some(source => source.id === filters.source)) filters.source = "";
  setSelect("year", "全部年份", years.map(year => [year, year + "年"]), filters.year);
  setSelect("topic", "全部专题", yearTopics.map(topic => [topic, topic]), filters.topic);
  setSelect("source", "全部期次", sourceOptions.map(({ id }) => {
    const day = id.slice(5).replace("-", "月") + "日";
    return [id, years.length > 1 && !filters.year ? id.slice(0, 4) + "年" + day : day];
  }), filters.source);
  setSelect("kind", "全部题型", Object.entries(types), filters.kind);

  deck = (order || [...questions.keys()]).filter(id => {
    const question = questions.get(id);
    const inMode = mode === "all" || (mode === "wrong"
      ? results.get(id)?.correct === false : favorites.has(id));
    return inMode && (!filters.year || question.source.startsWith(filters.year + "-"))
      && (!filters.topic || sources.get(question.source).topic === filters.topic)
      && (!filters.source || question.source === filters.source)
      && (!filters.kind || question.type === filters.kind);
  });
  cursor = Math.max(0, deck.indexOf(preferredId));
  gridPage = Math.floor(cursor / pageSize);
  roundResults = new Map();
  retryId = null;
  $("order").setAttribute("aria-pressed", String(Boolean(order)));
  $("order").textContent = order ? "恢复原序" : "随机顺序";
  for (const item of document.querySelectorAll("[data-mode]")) {
    item.setAttribute("aria-current", String(item.dataset.mode === mode));
  }
  render();
}

function displayResult(id) {
  if (retryId === id) return undefined;
  return mode === "wrong" ? roundResults.get(id) : results.get(id);
}

function goTo(index) {
  if (index < 0 || index >= deck.length) return;
  retryId = null;
  cursor = index;
  gridPage = Math.floor(cursor / pageSize);
  $("announcement").textContent = "";
  render();
  $("question-title")?.focus();
}

function makeOption(question, index, result) {
  const node = make("label", "option");
  const input = make("input");
  input.name = "option";
  input.type = question.type === "multiple" ? "checkbox" : "radio";
  input.value = String(index);
  input.checked = Boolean(result?.response.includes(index));
  input.disabled = Boolean(result);
  const label = make("span");
  if (question.type !== "boolean") label.append(make("span", "option-code", letters[index]));
  label.append(question.options[index]);
  node.append(input, label);
  if (result && question.answer.includes(index)) {
    node.classList.add("ok");
    node.append(make("span", "option-success", "正确答案"));
  } else if (result && input.checked) {
    node.classList.add("miss");
    node.append(make("span", "option-error", "选错"));
  }
  return node;
}

function makeField(field, index, result) {
  const label = make("label", "fill", field.label);
  const input = make("input");
  input.type = "text";
  input.name = "fill";
  input.maxLength = 120;
  input.autocomplete = "off";
  input.disabled = Boolean(result);
  input.value = result?.response[index] || "";
  label.append(input);
  return label;
}

function feedbackNode(question, result) {
  const node = make("section", "feedback" + (result.correct ? " correct" : ""));
  const title = make("h3", "", result.correct ? "回答正确" : "这道题答错了");
  title.id = "feedback-title";
  title.tabIndex = -1;
  node.append(title, make("p", "", "参考答案　" + answerText(question)), make("p", "", question.analysis));
  if (question.note) node.append(make("p", "", question.note));
  if (question.references) {
    const list = make("ul");
    for (const source of question.references) {
      const item = make("li");
      item.append(link(source.title, source.url));
      list.append(item);
    }
    node.append(list);
  }
  return node;
}

function toggleFavorite(id, node) {
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  node.textContent = favorites.has(id) ? "已收藏" : "收藏本题";
  node.setAttribute("aria-pressed", String(favorites.has(id)));
  renderSidebar();
  persist();
}

function setMode(next) {
  mode = next;
  resetFilters();
  refreshDeck();
}

function renderEmpty(host) {
  const empty = make("div", "empty");
  const filtered = Object.values(filters).some(Boolean);
  const title = filtered ? "没有符合筛选条件的题目" : mode === "wrong" ? "错题本暂无题目" : "暂无收藏";
  const message = filtered ? "清除筛选后可以查看当前练习范围内的全部题目。"
    : mode === "wrong" ? "在练习中答错的题目会自动收录，回练答对后移出。"
      : "在答题区选择“收藏本题”，之后可以在这里集中复习。";
  const heading = make("h2", "", title);
  heading.id = "question-title";
  heading.tabIndex = -1;
  empty.append(heading, make("p", "", message), button(filtered ? "清除筛选" : "开始练习", "primary", () => {
    if (filtered) {
      resetFilters();
      refreshDeck();
    } else {
      setMode("all");
    }
  }));
  host.append(empty);
}

function showSummary() {
  const attempted = deck.filter(id => displayResult(id)).length;
  const correct = deck.filter(id => displayResult(id)?.correct).length;
  const node = make("div", "empty");
  const heading = make("h2", "", "本组练习小结");
  heading.tabIndex = -1;
  node.append(heading, make("p", "", "共 " + deck.length + " 题，已练习 " + attempted + " 题，答对 " + correct + " 题。"));
  const actions = make("div", "question-actions");
  actions.append(
    button("返回题目", "outlined", () => goTo(cursor)),
    button("查看错题本", "outlined", () => setMode("wrong")),
  );
  node.append(actions);
  $("question").replaceChildren(node);
  heading.focus();
}

function recordAnswer(question, response) {
  const record = { response, correct: grade(question, response) };
  results.set(question.id, record);
  roundResults.set(question.id, record);
  retryId = null;
  render();
  $("feedback-title").focus();
  $("announcement").textContent = record.correct ? "回答正确" : "回答错误，已收录错题本";
}

function renderQuestion() {
  const host = $("question");
  host.replaceChildren();
  const question = questions.get(deck[cursor]);
  if (!question) {
    renderEmpty(host);
    return;
  }
  const result = displayResult(question.id);
  const source = sources.get(question.source);
  const meta = make("div", "question-meta");
  const tags = make("div");
  tags.append(make("span", "type", types[question.type]), make("span", "", source.topic),
    make("span", "", "第 " + (cursor + 1) + " / " + deck.length + " 题"));
  const mark = button(favorites.has(question.id) ? "已收藏" : "收藏本题", "text-button bookmark",
    () => toggleFavorite(question.id, mark));
  mark.setAttribute("aria-pressed", String(favorites.has(question.id)));
  meta.append(tags, mark);
  const title = make("h2", "question-title", question.prompt);
  title.id = "question-title";
  title.tabIndex = -1;
  host.append(meta, title);
  const multiSelect = !result && question.type === "multiple";
  if (multiSelect) {
    const hint = make("p", "hint", "选择 " + question.answer.length + " 项后自动判分。");
    hint.id = "choice-hint";
    host.append(hint);
  }

  const form = make("form");
  const options = make("fieldset", "options");
  options.setAttribute("aria-labelledby", title.id);
  if (multiSelect) options.setAttribute("aria-describedby", "choice-hint");
  if (question.type === "fill") {
    options.append(...question.fields.map((field, index) => makeField(field, index, result)));
  } else {
    options.append(...question.options.map((_, index) => makeOption(question, index, result)));
  }
  form.append(options);
  if (result) form.append(feedbackNode(question, result));

  const actions = make("div", "question-actions");
  const previous = button("上一题", "outlined", () => goTo(cursor - 1));
  previous.disabled = cursor === 0;
  const last = cursor === deck.length - 1;
  const next = button(last ? "查看小结" : "下一题", result ? "primary" : "outlined",
    () => last ? showSummary() : goTo(cursor + 1));
  actions.append(previous);
  if (result) {
    actions.append(button("重新作答", "text-button", () => {
      retryId = question.id;
      renderQuestion();
      $("question-title").focus();
    }), next);
  } else if (question.type === "fill") {
    const submit = make("button", "primary", "提交答案");
    submit.type = "submit";
    const selected = () => new FormData(form).getAll("fill");
    const canSubmit = response => response.length === question.fields.length
      && response.every(value => normalize(value));
    submit.disabled = true;
    form.addEventListener("input", () => { submit.disabled = !canSubmit(selected()); });
    form.addEventListener("submit", event => {
      event.preventDefault();
      const response = selected();
      if (!canSubmit(response)) return;
      recordAnswer(question, response);
    });
    actions.append(next, submit);
  } else {
    options.addEventListener("change", () => {
      const response = new FormData(form).getAll("option").map(Number);
      if (response.length === question.answer.length) recordAnswer(question, response);
    });
    actions.append(next);
  }
  form.append(actions);
  const citation = make("p", "question-source", "来源　");
  citation.append(link(source.id + " 原文 · 第" + question.number + "题", source.url));
  host.append(form, citation);
}

function renderSidebar() {
  const allResults = [...results.values()];
  const correct = allResults.filter(result => result.correct).length;
  $("wrong-count").textContent = String(allResults.length - correct);
  $("saved-count").textContent = String(favorites.size);
  $("attempted").textContent = allResults.length + " / " + questions.size;
  $("accuracy").textContent = allResults.length ? Math.round(correct * 100 / allResults.length) + "%" : "—";
  $("progress").max = questions.size;
  $("progress").value = allResults.length;
  $("deck-size").textContent = deck.length + " 题";
  const totalPages = Math.ceil(deck.length / pageSize);
  const begin = gridPage * pageSize;
  const numberButtons = deck.slice(begin, begin + pageSize).map((id, index) => {
    const result = results.get(id);
    const position = begin + index;
    const status = !result ? "未答" : result.correct ? "答对" : "答错";
    const node = button(String(position + 1), !result ? "" : result.correct ? "correct" : "wrong",
      () => goTo(position));
    node.setAttribute("aria-label", "第 " + (position + 1) + " 题，" + status);
    node.setAttribute("aria-current", String(position === cursor));
    return node;
  });
  $("number-grid").replaceChildren(...numberButtons);
  $("grid-footer").hidden = totalPages <= 1;
  $("grid-prev").disabled = gridPage === 0;
  $("grid-next").disabled = gridPage >= totalPages - 1;
  $("grid-page").textContent = (gridPage + 1) + " / " + totalPages;
}

function render() {
  renderQuestion();
  renderSidebar();
  persist();
}

for (const key of Object.keys(filters)) {
  $(key).addEventListener("change", () => {
    filters[key] = $(key).value;
    refreshDeck();
  });
}
for (const item of document.querySelectorAll("[data-mode]")) {
  item.addEventListener("click", () => setMode(item.dataset.mode));
}
$("order").addEventListener("click", () => {
  if (order) {
    order = null;
  } else {
    order = [...questions.keys()];
    for (let index = order.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [order[index], order[swap]] = [order[swap], order[index]];
    }
  }
  refreshDeck();
});
$("grid-prev").addEventListener("click", () => { gridPage--; renderSidebar(); });
$("grid-next").addEventListener("click", () => { gridPage++; renderSidebar(); });
$("show-sources").addEventListener("click", () => $("sources").showModal());
for (const source of bank.sources) {
  const row = make("li");
  row.append(link(source.id + " 原文", source.url), make("span", "", source.topic + " · " + source.count + " 题"));
  $("source-list").append(row);
}
$("bank-size").textContent = String(questions.size);
$("page-title").textContent = bank.title;
$("publisher").textContent = bank.publisher;
document.title = bank.title;
const dates = [...sources.keys()].sort();
if (dates.length) {
  const format = date => date.replaceAll("-", ".");
  const first = dates[0];
  const last = dates.at(-1);
  const end = first.slice(0, 4) === last.slice(0, 4) ? last.slice(5) : last;
  $("bank-period").textContent = "赛题剧透 · " + format(first) + (first === last ? "" : "—" + format(end));
}
$("source-summary").textContent = "收录 " + sources.size + " 篇推文正文，共 " + questions.size + " 题。";
if (bank.sourceNote) {
  $("source-note").textContent = bank.sourceNote;
  $("source-note").hidden = false;
}
refreshDeck(stored.current);
$("loading").hidden = true;
$("review").hidden = false;
