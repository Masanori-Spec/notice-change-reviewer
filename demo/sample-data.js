(function (scope) {
  "use strict";
  var demo = {
    before: [
      "学内キャリア相談会（すべて合成したサンプル）",
      "開催日：2026年10月24日（土）",
      "時間：13:30",
      "場所：講義棟A 201教室",
      "申込期限：2026年10月20日",
      "参加申込はフォームへ登録してください。",
      "学生証を持参してください。"
    ].join("\n"),
    after: [
      "学内キャリア相談会（すべて合成したサンプル）",
      "開催日：2026年10月25日（日）",
      "時間：14:00",
      "場所：講義棟B 302教室",
      "申込期限：2026年10月22日",
      "参加申込はフォームへ登録してください。",
      "学生証を持参してください。",
      "事前アンケートに回答してください。"
    ].join("\n")
  };
  if (typeof module === "object" && module.exports) module.exports = demo;
  if (scope) scope.NoticeReviewDemo = demo;
})(typeof globalThis === "object" ? globalThis : this);
