(function (scope) {
  "use strict";

  var MAX_INPUT_LENGTH = 30000;
  var MAX_EXTRACTED_RECORDS = 200;
  var MAX_REVIEW_NOTES = 200;
  var MAX_RESULT_EVIDENCE_LENGTH = 200000;

  function outputLimitError() {
    var error = new RangeError("比較候補・確認メモ・根拠の量が上限を超えました。文面を項目ごとに分けてください。");
    error.code = "OUTPUT_LIMIT";
    return error;
  }
  var FIELDS = [
    { key: "eventDate", label: "開催日" },
    { key: "eventTime", label: "時刻" },
    { key: "location", label: "場所" },
    { key: "deadline", label: "締切" },
    { key: "action", label: "必要な対応" }
  ];
  var DATE_LABEL = /^(?:開催日時|実施日時|開催日|実施日|日時|日程)$/;
  var DEADLINE_LABEL = /^(?:提出期限|申込期限|申込み期限|申し込み期限|申請期限|回答期日|締め切り|締切|期限)(?:日時|日|時刻|時間)?$/;
  var LABEL_PATTERN = /(?:提出期限|申込期限|申込み期限|申し込み期限|申請期限|回答期日|締め切り|締切|期限)(?:日時|日|時刻|時間)?|開催日時|実施日時|開催日|実施日|日時|日程|開催時間|実施時間|開始時刻|終了時刻|時刻|時間|(?:実施場所|集合場所|場所|会場|教室)\s*:/g;
  var LOCATION_LABEL = /^(?:実施場所|集合場所|場所|会場|教室)\s*:$/;
  var ACTION_MARKER = /(?:提出|返信|登録|申請|回答|入力|記入|申込|申し込み|送信).{0,16}(?:してください|して下さい|すること|が必要|必須|お願いします|願います)|(?:持参|お持ち|持ってきて)(?:してください|して下さい|すること|ください|下さい)|(?:参加|出席|受講)してください|手続きをしてください|必ず.{0,16}(?:提出|返信|登録|申請|持参|回答|入力|記入|申込|申し込み|送信|参加|出席|受講)/;
  var ACTION_NEGATION = /任意|不要|必要(?:は|が)?ありません|必要(?:では)?ない|必要ではありません|必須では(?:ありません|ない)|しなくて(?:よい|いい)|しなくても(?:よい|いい|構いません)|しないで(?:ください|下さい)/;

  // Width conversion is one character to one character, so evidence offsets stay exact.
  function normalizeWidth(text) {
    return String(text).replace(/[！-～]/g, function (character) {
      return String.fromCharCode(character.charCodeAt(0) - 0xFEE0);
    });
  }

  function pad2(number) {
    return number < 10 ? "0" + number : String(number);
  }

  function validDate(year, month, day) {
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
  }

  function datesOnLine(text) {
    var found = [];
    var invalid = false;
    // Consume whole numeric components before validating their lengths. Never salvage
    // a plausible date from the middle of an oversized or malformed number.
    var pattern = /(?<!\d)(?:\d+\s*年\s*\d+\s*月\s*\d+\s*日?|\d+\s*[/-]\s*\d+\s*[/-]\s*\d+)/g;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      var parts = /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/.exec(match[0]);
      if (!parts) {
        var numeric = /^(\d{4})\s*([/-])\s*(\d{1,2})\s*\2\s*(\d{1,2})$/.exec(match[0]);
        if (numeric) parts = [numeric[0], numeric[1], numeric[3], numeric[4]];
      }
      var preceding = text.slice(0, match.index);
      var following = text.slice(pattern.lastIndex);
      var badBoundary = /[\dA-Za-z/.-]$/.test(preceding) || /^[\dA-Za-z/-]|^\.\d/.test(following);
      if (!parts || badBoundary || !validDate(Number(parts[1]), Number(parts[2]), Number(parts[3]))) {
        invalid = true;
      } else {
        found.push({ value: parts[1] + "-" + pad2(Number(parts[2])) + "-" + pad2(Number(parts[3])) });
      }
    }
    // A supported explicit-year date must not hide a recognizable yearless one.
    // Remove whole date tokens first so their month/day suffixes are not re-read.
    var residual = text.replace(pattern, " ");
    if (/(?<!\d)\d{1,2}\s*(?:月\s*\d{1,2}\s*日|[/-]\s*\d{1,2})(?!\d)/.test(residual)) invalid = true;
    return { values: found, invalid: invalid };
  }

  function timesOnLine(text) {
    var found = [];
    var invalid = false;
    // Seconds are consumed but rejected: they must not silently become minute precision.
    var pattern = /(?<!\d)(?:(午前|午後|am|pm)\s*)?(\d+)\s*(?::\s*(\d+)(?:\s*:\s*(\d+))?|時(?:\s*(?:(\d+)\s*分(?:\s*(\d+)\s*秒)?|(半)))?)(?:\s*(am|pm))?/gi;
    var match;
    while ((match = pattern.exec(text)) !== null) {
      var prefix = (match[1] || "").toLowerCase();
      var suffix = (match[8] || "").toLowerCase();
      var period = prefix || suffix;
      var hour = Number(match[2]);
      var minute = match[7] ? 30 : Number(match[3] || match[5] || 0);
      var preceding = text.slice(0, match.index);
      var following = text.slice(pattern.lastIndex);
      var badBoundary = /[\dA-Za-z:./-]$/.test(preceding) || /^[\dA-Za-z:分秒半]|^\.\d|^\s+\d/.test(following);
      var badPeriod = (prefix && suffix) || (period && hour > 12) || ((period === "am" || period === "pm") && hour < 1);
      var badPrecision = match[2].length > 2 || (match[3] && match[3].length !== 2) || (match[5] && match[5].length > 2) || match[4] || match[6];
      if (badBoundary || badPeriod || badPrecision || hour > 23 || minute > 59) {
        invalid = true;
        continue;
      }
      if (period) {
        hour %= 12;
        if (period === "午後" || period === "pm") hour += 12;
      }
      found.push({ value: pad2(hour) + ":" + pad2(minute), period: period });
    }
    // Do not infer an omitted AM/PM marker from a neighboring candidate.
    if (found.some(function (item) { return item.period; }) && found.some(function (item) { return !item.period; })) {
      invalid = true;
      found = found.filter(function (item) { return item.period; });
    }
    return { values: found, invalid: invalid };
  }

  function splitSentences(line) {
    var parts = [];
    var start = 0;
    for (var index = 0; index < line.length; index += 1) {
      if ("。！？!?".indexOf(line.charAt(index)) !== -1) {
        parts.push(line.slice(start, index + 1));
        start = index + 1;
      }
    }
    if (start < line.length) parts.push(line.slice(start));
    return parts.map(function (part) { return part.trim(); }).filter(Boolean);
  }

  function normalizedText(text) {
    return normalizeWidth(text).replace(/[ \t　]+/g, " ").replace(/\s+([。！？!?])/g, "$1").trim();
  }

  function labeledSegments(sentence) {
    var text = normalizeWidth(sentence);
    var labels = [];
    var match;
    LABEL_PATTERN.lastIndex = 0;
    while ((match = LABEL_PATTERN.exec(text)) !== null) {
      var kind = DATE_LABEL.test(match[0]) ? "event" : DEADLINE_LABEL.test(match[0]) ? "deadline" : LOCATION_LABEL.test(match[0]) ? "location" : "time";
      // A label-like word inside a place name is not a field boundary.
      if (kind !== "location" && !/^\s*(?::|は|が|を|\d|午前|午後|am|pm|[。!?]?$)/i.test(text.slice(LABEL_PATTERN.lastIndex))) continue;
      labels.push({ start: match.index, end: LABEL_PATTERN.lastIndex, kind: kind, expectsTime: /日時|時間|時刻/.test(match[0]) });
    }
    var segments = [];
    labels.forEach(function (label, index) {
      var end = index + 1 < labels.length ? labels[index + 1].start : text.length;
      var previous = segments[segments.length - 1];
      // A time label immediately after a dated field belongs to that field, not
      // automatically to the event (e.g. “申込期限: ... 時刻: 17:00”).
      if (label.kind === "time" && previous && (previous.kind === "event" || previous.kind === "deadline")) {
        previous.text += " " + text.slice(label.end, end).replace(/^\s*:\s*/, "");
        previous.expectsTime = true;
        previous.evidenceText = sentence.slice(previous.start, end).trim();
      } else {
        segments.push({ kind: label.kind, expectsTime: label.expectsTime, start: label.start, text: text.slice(label.end, end).replace(/^\s*:\s*/, ""), evidenceText: sentence.slice(label.start, end).trim() });
      }
    });
    return segments;
  }

  function extract(text) {
    text = String(text || "");
    if (text.length > MAX_INPUT_LENGTH) throw new RangeError("入力はそれぞれ30,000文字以内にしてください。");
    var fields = { eventDate: [], eventTime: [], location: [], deadline: [], action: [] };
    var notes = [];
    var recordCount = 0;
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");

    function note(message, lineNumber) {
      if (notes.length >= MAX_REVIEW_NOTES) throw outputLimitError();
      notes.push(message + "（" + lineNumber + "行目）。");
    }

    function addRecord(target, record) {
      if (target.some(function (existing) { return existing.value === record.value; })) return;
      if (recordCount >= MAX_EXTRACTED_RECORDS) throw outputLimitError();
      recordCount += 1;
      target.push(record);
    }

    function extractSegment(segment, lineNumber) {
      var evidence = { lineNumber: lineNumber, text: segment.evidenceText };
      if (segment.kind === "location") {
        var place = normalizedText(segment.text).replace(/^[\s:]+|[。.,、;]+$/g, "").trim();
        if (place) addRecord(fields.location, { value: place, evidence: evidence });
        else note("場所のラベルはありますが、場所を読み取れませんでした", lineNumber);
        return;
      }
      var dates = datesOnLine(segment.text);
      var times = timesOnLine(segment.text);
      var expectsTime = segment.expectsTime || /(?<!\d)\d+\s*[:時]|午前|午後|\b(?:am|pm)\b/i.test(segment.text);
      if (expectsTime && !times.values.length) times.invalid = true;
      var fieldName = segment.kind === "deadline" ? "締切" : "開催日";
      if (segment.kind !== "time" && (!dates.values.length || dates.invalid)) {
        note(fieldName + "の対応する日付を読み取れませんでした、または未対応・不正な日付が含まれています。原文で確認してください", lineNumber);
      }
      if (times.invalid || (segment.kind === "time" && !times.values.length)) {
        note((segment.kind === "deadline" ? "締切の時刻" : "時刻") + "を読み取れませんでした、または未対応・不正な時刻が含まれています。原文で確認してください", lineNumber);
      }
      if (segment.kind === "deadline") {
        if (times.invalid) return;
        if (times.values.length && (dates.values.length !== 1 || times.values.length !== 1 || dates.invalid)) {
          note("締切の日付と時刻の対応が曖昧なため、自動で結び付けていません。原文で確認してください", lineNumber);
          return;
        }
        dates.values.forEach(function (item) {
          addRecord(fields.deadline, { value: item.value + (times.values.length ? " " + times.values[0].value : ""), evidence: evidence });
        });
      } else {
        if (segment.kind === "event") dates.values.forEach(function (item) {
          addRecord(fields.eventDate, { value: item.value, evidence: evidence });
        });
        times.values.forEach(function (item) {
          addRecord(fields.eventTime, { value: item.value, evidence: evidence });
        });
      }
    }

    lines.forEach(function (originalLine, index) {
      splitSentences(originalLine).forEach(function (sentence) {
        var line = normalizeWidth(sentence);
        var actionMarker = ACTION_MARKER.test(line);
        var negated = ACTION_NEGATION.test(line);
        var action = actionMarker && !negated;
        if (action) {
          addRecord(fields.action, { value: normalizedText(sentence), evidence: { lineNumber: index + 1, text: sentence } });
        } else if (actionMarker && negated) {
          note("任意・否定表現を含む対応事項は自動判定していません。必要な対応が併記されていないか原文で確認してください", index + 1);
        }
        var segments = labeledSegments(sentence);
        if (!segments.length && line.indexOf("までに") !== -1 && action) {
          var deadlineText = line.slice(0, line.indexOf("までに"));
          if (datesOnLine(deadlineText).values.length > 1) {
            note("期限文に複数の日付があるため、締切を自動判定していません。原文で確認してください", index + 1);
          } else {
            extractSegment({ kind: "deadline", text: deadlineText, evidenceText: sentence }, index + 1);
          }
        }
        segments.forEach(function (segment) { extractSegment(segment, index + 1); });
      });
    });
    return { fields: fields, notes: unique(notes) };
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function compareField(field, beforeRecords, afterRecords, notes) {
    var beforeMap = new Map();
    var afterMap = new Map();
    beforeRecords.forEach(function (record) { beforeMap.set(record.value, record); });
    afterRecords.forEach(function (record) { afterMap.set(record.value, record); });
    var removed = beforeRecords.filter(function (record) { return !afterMap.has(record.value); });
    var added = afterRecords.filter(function (record) { return !beforeMap.has(record.value); });
    if (!removed.length && !added.length) return [];
    if (beforeRecords.length === 1 && afterRecords.length === 1 && removed.length === 1 && added.length === 1) {
      return [{ field: field.label, fieldKey: field.key, kind: "changed", before: removed[0], after: added[0] }];
    }
    if (removed.length && added.length && (beforeRecords.length > 1 || afterRecords.length > 1)) {
      notes.push(field.label + "に複数候補があるため、追加・削除として表示しています。変更前後の候補を原文で確認してください。");
    }
    return removed.map(function (record) {
      return { field: field.label, fieldKey: field.key, kind: "removed", before: record, after: null };
    }).concat(added.map(function (record) {
      return { field: field.label, fieldKey: field.key, kind: "added", before: null, after: record };
    }));
  }

  function analyze(beforeText, afterText) {
    var before = extract(beforeText);
    var after = extract(afterText);
    var notes = before.notes.map(function (note) { return "変更前：" + note; }).concat(
      after.notes.map(function (note) { return "変更後：" + note; })
    );
    var changes = [];
    FIELDS.forEach(function (field) {
      changes = changes.concat(compareField(field, before.fields[field.key], after.fields[field.key], notes));
    });
    var evidenceLength = 0;
    changes.forEach(function (change) {
      if (change.before) evidenceLength += change.before.evidence.text.length;
      if (change.after) evidenceLength += change.after.evidence.text.length;
      if (evidenceLength > MAX_RESULT_EVIDENCE_LENGTH) throw outputLimitError();
    });
    return { changes: changes, notes: unique(notes), before: before.fields, after: after.fields };
  }

  var api = { analyze: analyze, extract: extract, MAX_INPUT_LENGTH: MAX_INPUT_LENGTH, MAX_EXTRACTED_RECORDS: MAX_EXTRACTED_RECORDS, MAX_REVIEW_NOTES: MAX_REVIEW_NOTES, MAX_RESULT_EVIDENCE_LENGTH: MAX_RESULT_EVIDENCE_LENGTH };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (scope) scope.NoticeReviewAnalyzer = api;
})(typeof globalThis === "object" ? globalThis : this);
