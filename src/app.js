(function () {
  "use strict";

  var beforeInput = document.getElementById("before-text");
  var afterInput = document.getElementById("after-text");
  var beforeCount = document.getElementById("before-count");
  var afterCount = document.getElementById("after-count");
  var resultSection = document.getElementById("results");
  var resultCount = document.getElementById("result-count");
  var changeList = document.getElementById("change-list");
  var reviewNotes = document.getElementById("review-notes");
  var formError = document.getElementById("form-error");
  var analyzeButton = document.getElementById("analyze-button");

  function element(tagName, className, text) {
    var node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function updateCount(input, output) {
    output.textContent = input.value.length.toLocaleString("ja-JP") + " 文字";
  }

  function resetInputViewport(input) {
    input.setSelectionRange(0, 0);
    input.scrollTop = 0;
    input.scrollLeft = 0;
  }

  function renderEvidence(label, record, emptyText) {
    var side = element("div", "evidence-side");
    side.appendChild(element("span", "evidence-label", label));
    if (!record) {
      side.appendChild(element("p", "evidence-value", emptyText));
      return side;
    }
    side.appendChild(element("p", "evidence-value", record.value));
    side.appendChild(element("span", "evidence-quote", record.evidence.text));
    side.appendChild(element("span", "evidence-line", record.evidence.lineNumber + " 行目"));
    return side;
  }

  function renderChange(change) {
    var card = element("article", "change-card");
    card.setAttribute("data-kind", change.kind);
    var top = element("div", "change-top");
    var title = element("h3", "change-title", change.field);
    var labels = { changed: "変更", added: "追加", removed: "削除" };
    top.appendChild(title);
    top.appendChild(element("span", "change-kind", labels[change.kind]));
    card.appendChild(top);
    var evidence = element("div", "evidence-grid");
    evidence.appendChild(renderEvidence("変更前 · OLD", change.before, "該当なし"));
    evidence.appendChild(renderEvidence("変更後 · NEW", change.after, "該当なし"));
    card.appendChild(evidence);
    return card;
  }

  function renderNotes(notes) {
    reviewNotes.replaceChildren();
    if (!notes.length) {
      reviewNotes.hidden = true;
      return;
    }
    var list = element("ul");
    notes.forEach(function (note) { list.appendChild(element("li", "", note)); });
    reviewNotes.appendChild(element("strong", "", "原文で確認してください"));
    reviewNotes.appendChild(list);
    reviewNotes.hidden = false;
  }

  function showResults(result) {
    resultSection.hidden = false;
    changeList.replaceChildren();
    renderNotes(result.notes);
    resultCount.textContent = result.changes.length + " 件";
    if (!result.changes.length) {
      changeList.appendChild(element(
        "p",
        "empty-state",
        "対応づけられる対象項目の差分は見つかりませんでした。項目名がない文面や、ほかの文章の変更は検出範囲外です。"
      ));
      return;
    }
    result.changes.forEach(function (change) { changeList.appendChild(renderChange(change)); });
  }

  function clearError() {
    formError.hidden = true;
    formError.textContent = "";
  }

  function invalidateResults() {
    resultSection.hidden = true;
    changeList.replaceChildren();
    reviewNotes.replaceChildren();
    reviewNotes.hidden = true;
    resultCount.textContent = "";
    clearError();
  }

  beforeInput.addEventListener("input", function () {
    updateCount(beforeInput, beforeCount);
    invalidateResults();
  });
  afterInput.addEventListener("input", function () {
    updateCount(afterInput, afterCount);
    invalidateResults();
  });

  document.getElementById("demo-button").addEventListener("click", function () {
    beforeInput.value = window.NoticeReviewDemo.before;
    afterInput.value = window.NoticeReviewDemo.after;
    updateCount(beforeInput, beforeCount);
    updateCount(afterInput, afterCount);
    invalidateResults();
    beforeInput.focus();
    resetInputViewport(beforeInput);
    resetInputViewport(afterInput);
  });

  document.getElementById("swap-button").addEventListener("click", function () {
    var previousBefore = beforeInput.value;
    beforeInput.value = afterInput.value;
    afterInput.value = previousBefore;
    updateCount(beforeInput, beforeCount);
    updateCount(afterInput, afterCount);
    invalidateResults();
    afterInput.focus();
    resetInputViewport(beforeInput);
    resetInputViewport(afterInput);
  });

  document.getElementById("analyze-button").addEventListener("click", function () {
    invalidateResults();
    if (!beforeInput.value.trim() || !afterInput.value.trim()) {
      formError.textContent = "変更前と変更後の両方に文面を入力してください。合成デモでもお試しいただけます。";
      formError.hidden = false;
      return;
    }
    var limit = window.NoticeReviewAnalyzer.MAX_INPUT_LENGTH;
    if (beforeInput.value.length > limit || afterInput.value.length > limit) {
      formError.textContent = "1つの文面は " + limit.toLocaleString("ja-JP") + " 文字以内にしてください。長い文面は項目ごとに分けて比較してください。";
      formError.hidden = false;
      return;
    }
    analyzeButton.disabled = true;
    try {
      showResults(window.NoticeReviewAnalyzer.analyze(beforeInput.value, afterInput.value));
    } catch (error) {
      formError.textContent = error && error.code === "OUTPUT_LIMIT"
        ? "比較候補・確認メモ・根拠の量が上限を超えました。結果の一部だけを表示せず比較を中止しました。文面を項目ごとに分けて、もう一度お試しください。"
        : "比較中に問題が起きました。文面を短くして、もう一度お試しください。";
      formError.hidden = false;
    } finally {
      analyzeButton.disabled = false;
    }
  });
})();
