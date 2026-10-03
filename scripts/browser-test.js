"use strict";
// Reproducible real DOM suite using official playwright@1.62.1.
// No forced clicks, custom browser launch flags, retries, university access or real user data.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");
const { createServer } = require("./serve.js");
const demo = require("../demo/sample-data.js");
const output = path.join(__dirname, "../artifacts");
const checks = [], requests = [], unexpectedRequests = [], errors = [], csp = [], dialogs = [], captures = [], timings = [];
let server, browser, page;
const allowedPaths = new Set(["/", "/index.html", "/styles.css", "/src/analyzer.js", "/src/app.js", "/demo/sample-data.js", "/favicon.ico"]);
const check = async (name, fn) => { await fn(); checks.push(name); console.log(`PASS ${name}`); };
const readCards = page => page.locator(".change-card").evaluateAll(cards => cards.map(card => ({
  field: card.querySelector("h3").textContent,
  kind: card.dataset.kind,
  values: [...card.querySelectorAll(".evidence-value")].map(node => node.textContent),
  quotes: [...card.querySelectorAll(".evidence-quote")].map(node => node.textContent),
  lines: [...card.querySelectorAll(".evidence-line")].map(node => node.textContent)
})));
const compare = async () => {
  await page.getByRole("button", {name: "変更を確認"}).click();
  await page.locator("#results").waitFor({state: "visible"});
};
const fill = async (before, after) => {
  await page.locator("#before-text").fill(before);
  await page.locator("#after-text").fill(after);
};
const loadDemo = async () => { await page.getByRole("button", {name: "合成デモを読み込む"}).click(); };
const noStaleResults = async () => {
  assert.equal(await page.locator("#results").isVisible(), false);
  assert.equal(await page.locator(".change-card").count(), 0);
  assert.equal(await page.locator("#review-notes").textContent(), "");
  assert.equal(await page.locator("#result-count").textContent(), "");
};
const capture = async name => {
  await page.evaluate(async () => {
    document.activeElement?.blur(); window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const state = await page.evaluate(() => ({width: innerWidth, height: innerHeight, scrollX, scrollY, scrollWidth: document.documentElement.scrollWidth, cards: document.querySelectorAll(".change-card").length}));
  assert.equal(state.scrollX, 0); assert.equal(state.scrollY, 0);
  assert.ok(state.scrollWidth <= state.width);
  captures.push({name, ...state});
  await page.screenshot({path: path.join(output, `${name}.png`), fullPage: true, animations: "disabled"});
};
(async () => {
  await fs.mkdir(output, {recursive: true});
  try {
    server = createServer();
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({headless: true});
    const context = await browser.newContext({viewport: {width: 1440, height: 1100}, locale: "ja-JP", serviceWorkers: "block"});
    context.setDefaultTimeout(10000);
    context.on("request", request => requests.push({url: request.url(), method: request.method(), type: request.resourceType()}));
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || url.search || !allowedPaths.has(url.pathname) || request.method() !== "GET") {
        unexpectedRequests.push({url: request.url(), method: request.method()});
        await route.abort(); return;
      }
      await route.continue();
    });
    await context.exposeBinding("recordCsp", (_source, event) => csp.push(event));
    await context.addInitScript(() => document.addEventListener("securitypolicyviolation", event => window.recordCsp({directive: event.violatedDirective, blockedURI: event.blockedURI})));
    context.on("page", tab => {
      tab.on("pageerror", error => errors.push(error.message));
      tab.on("dialog", dialog => {dialogs.push({type: dialog.type(), message: dialog.message()}); dialog.dismiss();});
    });
    page = await context.newPage();
    await page.goto(origin, {waitUntil: "load"});
    await check("empty initial state has named inputs, status regions and no result", async () => {
      assert.equal(await page.title(), "お知らせ変更レビュー");
      assert.equal(await page.getByRole("textbox", {name: /変更前/}).count(), 1);
      assert.equal(await page.getByRole("textbox", {name: /変更後/}).count(), 1);
      assert.equal(await page.locator("html").getAttribute("lang"), "ja");
      assert.equal(await page.locator("#results").getAttribute("aria-live"), "polite");
      assert.equal(await page.locator("#form-error").getAttribute("role"), "alert");
      await noStaleResults();
    });
    await check("keyboard-only Tab, Enter and Space activate the real controls", async () => {
      await page.keyboard.press("Tab");
      assert.equal(await page.getByRole("link", {name: "お知らせ変更レビュー ホーム"}).evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("#demo-button").evaluate(el => el === document.activeElement), true);
      const focusStyle = await page.locator("#demo-button").evaluate(el => ({outline: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth}));
      assert.notEqual(focusStyle.outline, "none"); assert.notEqual(focusStyle.width, "0px");
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#before-text").inputValue(), demo.before);
      assert.equal(await page.locator("#before-text").evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("#after-text").evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("#swap-button").evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator("#analyze-button").evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Space");
      await page.locator("#results").waitFor({state: "visible"});
    });
    await check("demo DOM matches independent exact values, evidence and line numbers", async () => {
      assert.equal(await page.locator("#result-count").textContent(), "5 件");
      assert.deepEqual(await readCards(page), [
        {field:"開催日",kind:"changed",values:["2026-10-24","2026-10-25"],quotes:["開催日：2026年10月24日（土）","開催日：2026年10月25日（日）"],lines:["2 行目","2 行目"]},
        {field:"時刻",kind:"changed",values:["13:30","14:00"],quotes:["時間：13:30","時間：14:00"],lines:["3 行目","3 行目"]},
        {field:"場所",kind:"changed",values:["講義棟A 201教室","講義棟B 302教室"],quotes:["場所：講義棟A 201教室","場所：講義棟B 302教室"],lines:["4 行目","4 行目"]},
        {field:"締切",kind:"changed",values:["2026-10-20","2026-10-22"],quotes:["申込期限：2026年10月20日","申込期限：2026年10月22日"],lines:["5 行目","5 行目"]},
        {field:"必要な対応",kind:"added",values:["該当なし","事前アンケートに回答してください。"],quotes:["事前アンケートに回答してください。"],lines:["8 行目"]}
      ]);
      assert.equal(await page.locator("#review-notes").isVisible(), false);
    });
    await capture("desktop");
    await check("repeated comparison does not duplicate cards or leave button disabled", async () => {
      await compare(); await compare();
      assert.equal(await page.locator(".change-card").count(), 5);
      assert.equal(await page.locator("#analyze-button").isEnabled(), true);
    });
    await check("editing either input removes old cards, count and review notes", async () => {
      for (const id of ["before-text", "after-text"]) {
        await page.locator(`#${id}`).press("End");
        await page.locator(`#${id}`).press("Enter");
        await page.locator(`#${id}`).pressSequentially("合成追記");
        await noStaleResults();
        const value = await page.locator(`#${id}`).inputValue();
        assert.equal(await page.locator(`#${id.replace("-text","-count")}`).textContent(), value.length.toLocaleString("ja-JP") + " 文字");
        await compare();
      }
    });
    await check("swap invalidates results and recomparison reverses evidence direction", async () => {
      await loadDemo(); await compare();
      await page.getByRole("button", {name: "変更前と変更後を入れ替える"}).click();
      await noStaleResults();
      assert.equal(await page.locator("#before-text").inputValue(), demo.after);
      assert.equal(await page.locator("#after-text").inputValue(), demo.before);
      assert.equal(await page.locator("#after-text").evaluate(el => el === document.activeElement), true);
      await compare();
      const cards = await readCards(page);
      assert.deepEqual(cards[0].values, ["2026-10-25", "2026-10-24"]);
      assert.equal(cards[4].kind, "removed");
      assert.deepEqual(cards[4].values, ["事前アンケートに回答してください。", "該当なし"]);
    });
    await check("reloading the demo resets edited inputs and clears stale output", async () => {
      await loadDemo(); await noStaleResults();
      assert.equal(await page.locator("#before-text").inputValue(), demo.before);
      assert.equal(await page.locator("#after-text").inputValue(), demo.after);
      await compare();
    });
    await check("empty and whitespace inputs fail accessibly and recover", async () => {
      for (const id of ["before-text", "after-text"]) {
        await loadDemo(); await page.locator(`#${id}`).fill(" \n\t");
        await page.locator("#analyze-button").click(); await noStaleResults();
        assert.match(await page.getByRole("alert").innerText(), /両方/);
        await loadDemo(); assert.equal(await page.locator("#form-error").isVisible(), false);
      }
      await compare();
    });
    await check("30001 UTF-16 units are rejected and the exact 30000 boundary completes", async () => {
      await fill("場所：" + "合".repeat(29998), "場所：合成B");
      await page.locator("#analyze-button").click(); await noStaleResults();
      assert.match(await page.getByRole("alert").innerText(), /30,000/);
      await fill("場所：" + "合".repeat(29997), "場所：合成B");
      await compare(); assert.equal(await page.locator("#form-error").isVisible(), false);
      assert.equal((await readCards(page))[0].values[0].length, 29997);
      await fill("合成🙂", "合成🙂");
      assert.equal(await page.locator("#before-count").textContent(), "4 文字");
      await compare(); assert.equal(await page.locator("#result-count").textContent(), "0 件");
    });
    await check("malformed calendar dates and time precision produce review notes", async () => {
      await fill("開催日：2026/02/30\n時間：13:30:01\n申込期限：2026/10/20 17:99", "開催日：2026/02/30\n時間：13:30:01\n申込期限：2026/10/20 17:99");
      await compare();
      assert.equal(await page.locator(".change-card").count(), 0);
      assert.match(await page.locator("#review-notes").innerText(), /不正な日付/);
      assert.match(await page.locator("#review-notes").innerText(), /不正な時刻/);
      assert.match(await page.locator(".empty-state").innerText(), /検出範囲外/);
      await loadDemo(); await compare();
      assert.equal(await page.locator("#review-notes").isVisible(), false);
      assert.equal(await page.locator("#review-notes").textContent(), "");
    });
    await check("same-line event and deadline retain separate exact source excerpts", async () => {
      await fill("開催日時：2026/10/24 13:30 申込期限：2026/10/20 17:00", "開催日時：2026/10/24 14:00 申込期限：2026/10/20 18:00");
      await compare();
      assert.deepEqual(await readCards(page), [
        {field:"時刻",kind:"changed",values:["13:30","14:00"],quotes:["開催日時：2026/10/24 13:30","開催日時：2026/10/24 14:00"],lines:["1 行目","1 行目"]},
        {field:"締切",kind:"changed",values:["2026-10-20 17:00","2026-10-20 18:00"],quotes:["申込期限：2026/10/20 17:00","申込期限：2026/10/20 18:00"],lines:["1 行目","1 行目"]}
      ]);
    });
    await check("multiple locations remain explicit additions/removals with a warning", async () => {
      await fill("場所：合成A\n場所：合成B", "場所：合成C\n場所：合成D"); await compare();
      assert.deepEqual((await readCards(page)).map(c => c.kind), ["removed","removed","added","added"]);
      assert.match(await page.locator("#review-notes").innerText(), /複数候補/);
    });
    await check("HTML-like values and evidence remain inert literal text", async () => {
      const markup = '<img src="https://invalid.example/synthetic" onerror="alert(1)"><svg onload="alert(2)"></svg><script>alert(3)</script>';
      await fill("場所：合成A", "場所：" + markup); await compare();
      assert.equal((await readCards(page))[0].values[1], markup);
      assert.equal(await page.locator("#change-list img, #change-list svg, #change-list script").count(), 0);
      assert.deepEqual(dialogs, []);
    });
    await check("analysis exceptions clear results and leave a usable retry path", async () => {
      await loadDemo(); await compare();
      await page.evaluate(() => { window.realAnalyze = window.NoticeReviewAnalyzer.analyze; window.NoticeReviewAnalyzer.analyze = () => {throw new Error("Synthetic controlled failure");}; });
      try {
        await page.locator("#analyze-button").click(); await noStaleResults();
        assert.match(await page.getByRole("alert").innerText(), /問題/);
        assert.equal(await page.locator("#analyze-button").isEnabled(), true);
      } finally { await page.evaluate(() => {window.NoticeReviewAnalyzer.analyze = window.realAnalyze; delete window.realAnalyze;}); }
      await compare(); assert.equal(await page.locator("#form-error").isVisible(), false);
    });
    await check("long malformed numbers and dense results complete on the real DOM", async () => {
      for (const item of [
        {name:"30000 digits",before:"開催日時："+"9".repeat(29995),after:"開催日時：2026/10/25 14:00",count:2},
        {name:"200 distinct locations per side",before:Array.from({length:200},(_,i)=>`場所：合成A${i}`).join("\n"),after:Array.from({length:200},(_,i)=>`場所：合成B${i}`).join("\n"),count:400}
      ]) {
        await fill(item.before,item.after);
        const start=performance.now(); await compare();
        const count=await page.locator(".change-card").count();
        const elapsed=performance.now()-start;
        assert.equal(count,item.count); assert.ok(elapsed<10000, `${item.name}: ${elapsed}ms`);
        timings.push({name:item.name,beforeLength:item.before.length,afterLength:item.after.length,cards:count,clickToDomMs:+elapsed.toFixed(2)});
      }
      await loadDemo(); await compare();
    });
    await check("output amplification and excessive warnings reject fully then recover", async () => {
      const dates = offset => "開催日："+Array.from({length:2726},(_,i)=>`${i+offset}/01/01`).join("、");
      const repeatedEvidence = offset => "開催日："+Array.from({length:100},(_,i)=>`${i+offset}/01/01`).join("、");
      for(const [before,after] of [
        ["日時:\n".repeat(7500),"日時:\n".repeat(7500)],
        [dates(1000),dates(5000)],
        [repeatedEvidence(1000),repeatedEvidence(5000)]
      ]) {
        await fill(before,after);
        const start=performance.now(); await page.locator("#analyze-button").click();
        await noStaleResults();
        assert.match(await page.getByRole("alert").innerText(),/量が上限.*比較を中止/);
        assert.ok(performance.now()-start<10000);
        assert.equal(await page.locator("#analyze-button").isEnabled(),true);
      }
      await loadDemo(); await compare(); assert.equal(await page.locator("#form-error").isVisible(),false);
    });
    await check("390px and 320px layouts allow real editing, swap and comparison without overflow", async () => {
      for (const width of [390,320]) {
        await page.setViewportSize({width,height:844});
        await loadDemo(); await compare();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
        const a=await page.locator("#before-text").boundingBox(), b=await page.locator("#after-text").boundingBox();
        assert.ok(b.y>a.y+a.height);
        await page.locator("#swap-button").click(); await noStaleResults(); await compare();
        assert.deepEqual((await readCards(page))[0].values,["2026-10-25","2026-10-24"]);
        await page.locator("#after-text").fill("場所："+"A".repeat(1000)); await noStaleResults(); await compare();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
        await loadDemo(); await compare(); await capture(`mobile-${width}`);
      }
    });
    await check("reduced-motion preference suppresses decorative transitions", async () => {
      await page.emulateMedia({reducedMotion:"reduce"});
      const duration=await page.locator("#analyze-button").evaluate(el=>getComputedStyle(el).transitionDuration);
      assert.ok(duration.split(",").every(value=>parseFloat(value)<0.001),duration);
    });
    await check("runtime uses no browser storage and reload starts without application results", async () => {
      assert.deepEqual(await page.evaluate(async()=>({local:localStorage.length,session:sessionStorage.length,cookie:document.cookie,databases:(await indexedDB.databases()).length,caches:(await caches.keys()).length,registrations:(await navigator.serviceWorker.getRegistrations()).length})),{local:0,session:0,cookie:"",databases:0,caches:0,registrations:0});
      assert.deepEqual(await context.cookies(),[]);
      await page.reload({waitUntil:"load"}); await noStaleResults();
      // Browser restoration of form values is not a persistence guarantee of this app.
    });
    await check("all instrumented UI flows have no page errors, CSP violations or non-asset requests", async () => {
      assert.deepEqual(errors,[]); assert.deepEqual(csp,[]); assert.deepEqual(unexpectedRequests,[]); assert.deepEqual(dialogs,[]);
      assert.ok(requests.length>=5);
      assert.ok(requests.every(request=>new URL(request.url).origin===origin && !new URL(request.url).search && allowedPaths.has(new URL(request.url).pathname) && request.method==="GET"));
    });
    const report={measuredAt:new Date().toISOString(),sourceCommit:process.env.GITHUB_SHA||null,node:process.version,playwright:require("playwright/package.json").version,chromium:browser.version(),checks,captures,timings,errors,csp,unexpectedRequests,dialogs,requests:requests.map(request=>({...request,url:request.url.replace(origin,"<local-origin>")})),limitations:["Synthetic Chromium automation on a loopback HTTP server; no physical-device, other-browser, file:// or screen-reader verification.","Input exception recovery uses one controlled analyzer stub; ordinary comparisons use the real parser and DOM.","Mobile checks change viewport size and do not emulate a physical touch device.","No external application requests were observed; an allowlist aborts and fails on attempted non-asset requests. This is not a security audit.","Screenshot files capture layout evidence; automated overflow checks are not complete visual or accessibility validation.","Timings include one Playwright click-to-DOM observation, not a stable latency benchmark or user-device guarantee."]};
    await fs.writeFile(path.join(output,"browser-results.json"),JSON.stringify(report,null,2)+"\n");
    console.log(JSON.stringify(report,null,2));
  } catch(error) {
    if(page)await page.screenshot({path:path.join(output,"failure.png"),fullPage:true}).catch(()=>{});
    await fs.writeFile(path.join(output,"browser-failure.json"),JSON.stringify({checks,error:String(error),errors,csp,unexpectedRequests},null,2)+"\n");
    throw error;
  } finally {
    if(browser)await browser.close();
    if(server)await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
