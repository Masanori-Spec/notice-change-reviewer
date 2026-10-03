"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, extract } = require("../src/analyzer.js");
const demo = require("../demo/sample-data.js");

test("synthetic demo finds schedule, deadline, location and a new required action with evidence", () => {
  const result = analyze(demo.before, demo.after);
  const changed = (field) => result.changes.find((entry) => entry.field === field && entry.kind === "changed");

  assert.equal(changed("開催日").before.value, "2026-10-24");
  assert.equal(changed("開催日").after.value, "2026-10-25");
  assert.equal(changed("時刻").before.value, "13:30");
  assert.equal(changed("時刻").after.value, "14:00");
  assert.equal(changed("場所").before.value, "講義棟A 201教室");
  assert.equal(changed("場所").after.value, "講義棟B 302教室");
  assert.equal(changed("締切").before.value, "2026-10-20");
  assert.equal(changed("締切").after.value, "2026-10-22");

  const newAction = result.changes.find((entry) =>
    entry.field === "必要な対応" &&
    entry.kind === "added" &&
    entry.after.value.includes("事前アンケート")
  );
  assert.ok(newAction);
  assert.match(newAction.after.evidence.text, /事前アンケート/);
  assert.equal(newAction.after.evidence.lineNumber, 8);
  assert.deepEqual(result.notes, []);
});

test("normalizes Japanese full-width digits and keeps explicit year and source line", () => {
  const found = extract("開催日：２０２６年１０月２４日\n時間：午後１時３０分");
  assert.equal(found.fields.eventDate[0].value, "2026-10-24");
  assert.equal(found.fields.eventTime[0].value, "13:30");
  assert.equal(found.fields.eventDate[0].evidence.lineNumber, 1);
});

test("does not treat optional or negated actions as required", () => {
  const found = extract("提出は不要です。\n参加登録は任意です。\n学生証を持参してください。");
  assert.equal(found.fields.action.length, 1);
  assert.equal(found.fields.action[0].value, "学生証を持参してください。");
});

test("leaves multiple changed candidates unpaired and asks for source review", () => {
  const result = analyze(
    "開催日：2026年10月24日\n開催日：2026年10月25日",
    "開催日：2026年10月26日\n開催日：2026年10月27日"
  );
  assert.equal(result.changes.filter((entry) => entry.field === "開催日" && entry.kind === "changed").length, 0);
  assert.equal(result.changes.filter((entry) => entry.field === "開催日" && entry.kind === "removed").length, 2);
  assert.equal(result.changes.filter((entry) => entry.field === "開催日" && entry.kind === "added").length, 2);
  assert.ok(result.notes.some((note) => note.includes("原文で確認してください")));
});

test("invalid calendar dates are not normalized into plausible dates", () => {
  const result = analyze("開催日：2026年2月30日", "開催日：2026年3月2日");
  assert.equal(result.before.eventDate.length, 0);
  assert.equal(result.after.eventDate[0].value, "2026-03-02");
  assert.ok(result.notes.some((note) => note.includes("読み取れませんでした")));
});

test("identical supported fields do not produce a difference", () => {
  const text = "日時：2026年10月24日 13:30\n場所：講義棟A 201教室";
  const result = analyze(text, text);
  assert.equal(result.changes.length, 0);
});

test("normalizes full-width separators without changing original evidence", () => {
  const text = "日時：２０２６／１０／２４　午後１：３０";
  const found = extract(text);
  assert.equal(found.fields.eventDate[0].value, "2026-10-24");
  assert.equal(found.fields.eventTime[0].value, "13:30");
  assert.equal(found.fields.eventTime[0].evidence.text, text);
  assert.deepEqual(found.notes, []);
  assert.equal(extract("開催日：２０２６－１０－２４").fields.eventDate[0].value, "2026-10-24");
});

test("does not salvage valid dates from malformed numeric tokens", () => {
  for (const value of ["12026/10/24", "2026/010/24", "2026/10/241", "2026/10-24", "2026/10/24/25", "-2026/10/24", "2026/10/24.5", "x2026/10/24", "12026年10月24日", "2026年10月241日", "2026年10月24日1"]) {
    const found = extract("開催日：" + value);
    assert.deepEqual(found.fields.eventDate, [], value);
    assert.ok(found.notes.length, value);
  }
});

test("calendar validation handles leap centuries and explicit four-digit years", () => {
  for (const value of ["1900/02/29", "2100/02/29", "2026/00/10", "2026/13/10", "2026/10/00", "0000/01/01"]) {
    assert.deepEqual(extract("開催日：" + value).fields.eventDate, [], value);
  }
  for (const [value, normalized] of [["2000/02/29", "2000-02-29"], ["2028/02/29", "2028-02-29"], ["0001/01/01", "0001-01-01"]]) {
    assert.equal(extract("開催日：" + value).fields.eventDate[0].value, normalized);
  }
});

test("valid dates do not hide a malformed candidate on the same labeled segment", () => {
  const found = extract("開催日：2026/10/24、2026/10/251");
  assert.deepEqual(found.fields.eventDate.map((entry) => entry.value), ["2026-10-24"]);
  assert.ok(found.notes.length);
});

test("accepts explicit Japanese and English AM/PM without changing noon or midnight", () => {
  for (const [value, normalized] of [["午前12時", "00:00"], ["午後12時", "12:00"], ["午前0時", "00:00"], ["午後0時", "12:00"], ["午後1:30", "13:30"], ["1:30 PM", "13:30"], ["12:00 am", "00:00"], ["12:00 pm", "12:00"], ["ＰＭ１：３０", "13:30"], ["13時半", "13:30"]]) {
    const found = extract("時間：" + value);
    assert.deepEqual(found.fields.eventTime.map((entry) => entry.value), [normalized], value);
    assert.deepEqual(found.notes, [], value);
  }
});

test("does not salvage valid times from malformed or unsupported tokens", () => {
  for (const value of ["113:30", "13:300", "13:3", "24:00", "13:60", "13:30:00", "13時30分00秒", "13時99分", "13時30", "13時 30", "13時300分", "午後13時", "13:30 PM", "0:30 PM", "AM 1:30 PM", "x13:30", "-1:30", "13.5時", "13:30.5", "13:xx"]) {
    const found = extract("時間：" + value);
    assert.deepEqual(found.fields.eventTime, [], value);
    assert.ok(found.notes.length, value);
  }
});

test("does not silently infer AM/PM for another time in a range", () => {
  const found = extract("時間：午後1時〜3時");
  assert.deepEqual(found.fields.eventTime.map((entry) => entry.value), ["13:00"]);
  assert.ok(found.notes.length);
});

test("isolates same-line event, deadline, time and location labels", () => {
  const found = extract("開催日：2026/10/24 時刻：13:00 締切：2026/10/20 時刻：17:00 会場：講義棟A");
  assert.deepEqual(found.fields.eventDate.map((entry) => entry.value), ["2026-10-24"]);
  assert.deepEqual(found.fields.eventTime.map((entry) => entry.value), ["13:00"]);
  assert.deepEqual(found.fields.deadline.map((entry) => entry.value), ["2026-10-20 17:00"]);
  assert.deepEqual(found.fields.location.map((entry) => entry.value), ["講義棟A"]);
  assert.equal(found.fields.deadline[0].evidence.text, "締切：2026/10/20 時刻：17:00");
  assert.deepEqual(found.notes, []);
});

test("deadline labels with date/time suffixes are not reclassified as event labels", () => {
  for (const label of ["締切日時", "申込期限日時", "締め切り日"]) {
    const found = extract(label + "：2026/10/20 17:00");
    assert.deepEqual(found.fields.deadline.map((entry) => entry.value), ["2026-10-20 17:00"]);
    assert.deepEqual(found.fields.eventDate, []);
    assert.deepEqual(found.fields.eventTime, []);
  }
});

test("deadline time-only changes and removed deadline times remain visible", () => {
  const result = analyze("申込期限：2026/10/20 17:00", "申込期限：2026/10/20 18:00");
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].fieldKey, "deadline");
  assert.equal(result.changes[0].before.value, "2026-10-20 17:00");
  assert.equal(result.changes[0].after.value, "2026-10-20 18:00");
  const removedTime = analyze("締切：2026/10/20 17:00", "締切：2026/10/20");
  assert.equal(removedTime.changes[0].kind, "changed");
  assert.equal(removedTime.changes[0].after.value, "2026-10-20");
});

test("invalid or missing deadline times are not silently reduced to date-only deadlines", () => {
  for (const value of ["2026/10/20 25:00", "2026/10/20 17:xx", "2026/10/20 時刻：未定", "17:00"]) {
    const found = extract("締切：" + value);
    assert.deepEqual(found.fields.deadline, [], value);
    assert.deepEqual(found.fields.eventTime, [], value);
    assert.ok(found.notes.length, value);
  }
});

test("multiple dates and times in one deadline remain unpaired with a review note", () => {
  for (const value of ["2026/10/20 17:00、2026/10/21 18:00", "2026/10/20 17:00、18:00"]) {
    const found = extract("締切：" + value);
    assert.deepEqual(found.fields.deadline, []);
    assert.ok(found.notes.some((note) => note.includes("曖昧")));
  }
});

test("optional sentence does not suppress a mandatory deadline in the same line", () => {
  const text = "資料の提出は不要です。2026/10/20 17:00までに登録してください。";
  const found = extract(text);
  assert.deepEqual(found.fields.deadline.map((entry) => entry.value), ["2026-10-20 17:00"]);
  assert.equal(found.fields.action.length, 1);
  assert.equal(found.fields.action[0].evidence.lineNumber, 1);
  assert.equal(found.fields.action[0].value, "2026/10/20 17:00までに登録してください。");
});

test("mixed optional and required clauses are flagged rather than treated as certain", () => {
  const found = extract("資料提出は任意ですが、参加登録してください。");
  assert.deepEqual(found.fields.action, []);
  assert.ok(found.notes.some((note) => note.includes("任意・否定")));
});

test("implicit deadlines use only the temporal text before the deadline marker", () => {
  const found = extract("2026/10/20までに13:00の枠を登録してください。");
  assert.equal(found.fields.deadline[0].value, "2026-10-20");
  assert.deepEqual(found.fields.eventTime, []);
  const ambiguous = extract("2026/10/24の相談会には2026/10/20までに登録してください。");
  assert.deepEqual(ambiguous.fields.deadline, []);
  assert.ok(ambiguous.notes.length);
});

test("one-to-many and many-to-one replacements both receive ambiguity notes", () => {
  const one = "開催日：2026/10/24";
  const many = "開催日：2026/10/25\n開催日：2026/10/26";
  for (const [before, after] of [[one, many], [many, one]]) {
    const result = analyze(before, after);
    assert.equal(result.changes.length, 3);
    assert.ok(result.changes.every((entry) => entry.kind !== "changed"));
    assert.ok(result.notes.some((note) => note.includes("複数候補")));
  }
});

test("normalizes CRLF and equivalent supported formats without differences", () => {
  const before = "日時：２０２６年１０月２４日 午後１時３０分\r\n場所：講義棟Ａ\r\n締切：２０２６／１０／２０　午後５時";
  const after = "日時：2026/10/24 13:30\n場所：講義棟A\n締切：2026-10-20 17:00";
  assert.deepEqual(analyze(before, after).changes, []);
  assert.equal(extract(before).fields.deadline[0].evidence.lineNumber, 3);
});

test("enforces the shared input bound for extract and either analyze input", () => {
  const { MAX_INPUT_LENGTH } = require("../src/analyzer.js");
  assert.equal(MAX_INPUT_LENGTH, 30000);
  assert.doesNotThrow(() => extract("x".repeat(MAX_INPUT_LENGTH)));
  const oversized = "x".repeat(MAX_INPUT_LENGTH + 1);
  assert.throws(() => extract(oversized), RangeError);
  assert.throws(() => analyze(oversized, "開催日：2026/10/24"), RangeError);
  assert.throws(() => analyze("開催日：2026/10/24", oversized), RangeError);
});

test("long malformed digit runs are rejected without suffix extraction", () => {
  const found = extract("開催日：" + "1".repeat(29000) + "/10/24\n時間：" + "1".repeat(900) + ":30");
  assert.deepEqual(found.fields.eventDate, []);
  assert.deepEqual(found.fields.eventTime, []);
  assert.ok(found.notes.length >= 2);
});

test("label-like words inside location names do not create field boundaries", () => {
  for (const name of ["日程調整室", "開催日時相談室", "提出期限確認室", "時間管理ホール", "日程 調整室"]) {
    const found = extract("場所：" + name);
    assert.deepEqual(found.fields.location.map((entry) => entry.value), [name], name);
    assert.deepEqual(found.fields.eventDate, [], name);
    assert.deepEqual(found.fields.eventTime, [], name);
    assert.deepEqual(found.fields.deadline, [], name);
    assert.deepEqual(found.notes, [], name);
  }
});

test("analysis notes identify which input contains an unsupported field", () => {
  const result = analyze("開催日：2026/02/30", "開催日：2026/02/31");
  assert.equal(result.notes.length, 2);
  assert.match(result.notes[0], /^変更前：/);
  assert.match(result.notes[1], /^変更後：/);
  assert.ok(result.notes.every((note) => note.includes("1行目")));
});

test("an empty location label requests manual review", () => {
  const found = extract("場所：");
  assert.deepEqual(found.fields.location, []);
  assert.ok(found.notes.some(note => note.includes("場所を読み取れませんでした")));
});
